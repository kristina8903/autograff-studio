-- Phase 7: founder review and approval. See docs/PRODUCT_SPEC.md §7,
-- docs/DATA_MODEL.md §8 and docs/SECURITY.md §11, decisions D-05, D-11, D-32.
--
-- * Founders never read the draft tables directly. They use the founder_*
--   functions below, which return only their own shared drafts and never the
--   rationale, admin-internal comments or flags not shared with them.
-- * An approval binds to the normalized content hash of the exact version the
--   founder saw. A later version with a different hash invalidates it in the
--   same transaction (trigger); a whitespace-only change does not.
-- * The selected opening line is part of what the founder approved
--   (PRODUCT_SPEC §7.4): the approval also records it, and changing it is
--   material. Unselected alternative opening lines are suggestions only (D-32).

create type public.approval_decision as enum ('approved', 'rejected');
create type public.comment_visibility as enum ('shared', 'admin_internal');
create type public.rewrite_status as enum ('requested', 'completed', 'failed');

-- The version's selected opening line, normalized like the body, or null.
create function private.selected_hook(p_version public.draft_versions) returns text
language sql immutable set search_path = '' as $$
  select case when p_version.selected_hook_index is not null
    then private.normalize_body(p_version.alternative_hooks[p_version.selected_hook_index + 1]) end;
$$;

-- Statuses in which a shared draft is visible to its founder.
create function private.founder_visible(p_status public.draft_status) returns boolean
language sql immutable set search_path = '' as $$
  select p_status in ('founder_review', 'changes_requested', 'approved', 'scheduled', 'published');
$$;

-- ---------------------------------------------------------------------------
-- Approvals
-- ---------------------------------------------------------------------------

create table public.approvals (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id),
  draft_id uuid not null references public.drafts (id) on delete cascade,
  draft_version_id uuid not null references public.draft_versions (id),
  -- Copied from the version at approval time.
  body_hash bytea not null,
  selected_hook text,
  approver_user_id uuid not null references public.profiles (user_id),
  approver_role public.user_role not null,
  decision public.approval_decision not null,
  note text not null default '' check (length(note) <= 1000),
  created_at timestamptz not null default now(),
  invalidated_at timestamptz,
  invalidated_reason text check (length(invalidated_reason) <= 300),
  invalidated_by_version_id uuid references public.draft_versions (id),
  check (decision = 'approved' or invalidated_at is null)
);
-- At most one live approval per draft.
create unique index approvals_one_live_idx on public.approvals (draft_id)
  where decision = 'approved' and invalidated_at is null;

-- Insert-only, except that an approval can be invalidated once.
create function private.approvals_guard() returns trigger
language plpgsql set search_path = '' as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'approvals cannot be deleted' using errcode = '42501';
  end if;
  if old.invalidated_at is not null
     or new.invalidated_at is null
     or (to_jsonb(new) - '{invalidated_at,invalidated_reason,invalidated_by_version_id}'::text[])
        is distinct from (to_jsonb(old) - '{invalidated_at,invalidated_reason,invalidated_by_version_id}'::text[]) then
    raise exception 'an approval can only be invalidated, once' using errcode = '42501';
  end if;
  return new;
end;
$$;
create trigger approvals_guard before update or delete on public.approvals
  for each row execute function private.approvals_guard();

-- The draft's live approval, if it still matches the current version's hash.
create function private.valid_approval(p_draft_id uuid) returns public.approvals
language sql stable security definer set search_path = '' as $$
  select a.* from public.approvals a
  join public.drafts d on d.id = a.draft_id
  join public.draft_versions v on v.id = d.current_version_id
  join public.founders f on f.id = d.founder_id
  where a.draft_id = p_draft_id and a.decision = 'approved' and a.invalidated_at is null
    and a.body_hash = v.body_normalized_hash
    and a.selected_hook is not distinct from private.selected_hook(v)
    and a.approver_user_id = f.user_id;
$$;

-- Material-edit rule (PRODUCT_SPEC §7.4, D-05): a new version whose content
-- hash or selected opening line differs from the live approval's invalidates it, returns the draft to
-- review and unschedules it, in the inserting transaction.
create function private.invalidate_on_material_edit() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_approval public.approvals;
  v_draft public.drafts;
begin
  select * into v_approval from public.approvals
  where draft_id = new.draft_id and decision = 'approved' and invalidated_at is null
  for update;
  if not found or (v_approval.body_hash = new.body_normalized_hash
                   and v_approval.selected_hook is not distinct from private.selected_hook(new)) then
    return new;
  end if;
  update public.approvals
  set invalidated_at = now(), invalidated_reason = 'material edit', invalidated_by_version_id = new.id
  where id = v_approval.id;
  select * into v_draft from public.drafts where id = new.draft_id for update;
  update public.drafts
  set status = case when new.author_kind = 'admin' then 'admin_review' else 'founder_review' end::public.draft_status,
      proposed_date = coalesce(proposed_date, scheduled_for::date),
      scheduled_for = null
  where id = new.draft_id;
  update public.calendar_slots set status = 'open', draft_id = null where draft_id = new.draft_id and status = 'filled';
  perform private.log_event(v_draft.company_id, 'approval.invalidated', 'draft', new.draft_id,
    jsonb_build_object('approval_id', v_approval.id, 'version_id', new.id, 'author', new.author_kind));
  return new;
end;
$$;
create trigger draft_versions_material_edit after insert on public.draft_versions
  for each row execute function private.invalidate_on_material_edit();

-- ---------------------------------------------------------------------------
-- Comments and rewrite requests
-- ---------------------------------------------------------------------------

create table public.comments (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id),
  draft_id uuid not null references public.drafts (id) on delete cascade,
  draft_version_id uuid not null references public.draft_versions (id),
  author_user_id uuid references public.profiles (user_id) on delete set null,
  author_role public.user_role not null,
  body text not null check (length(trim(body)) between 1 and 2000),
  -- {"quote": "…"}: the text the comment is about, as it appeared in that version.
  anchor jsonb check (anchor is null or (jsonb_typeof(anchor) = 'object' and length(anchor ->> 'quote') <= 500)),
  visibility public.comment_visibility not null,
  resolved_at timestamptz,
  resolved_by uuid references public.profiles (user_id) on delete set null,
  created_at timestamptz not null default now(),
  check (author_role = 'admin' or visibility = 'shared')
);
create index comments_draft_idx on public.comments (draft_id, created_at);

create table public.rewrite_requests (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id),
  draft_id uuid not null references public.drafts (id) on delete cascade,
  requested_by uuid references public.profiles (user_id) on delete set null,
  instructions text not null check (length(trim(instructions)) between 1 and 1000),
  status public.rewrite_status not null default 'requested',
  generation_run_id uuid references public.generation_runs (id),
  resulting_version_id uuid references public.draft_versions (id),
  created_at timestamptz not null default now(),
  completed_at timestamptz
);
create index rewrite_requests_draft_idx on public.rewrite_requests (draft_id, created_at desc);

alter table public.approvals enable row level security;
alter table public.comments enable row level security;
alter table public.rewrite_requests enable row level security;
revoke insert, update, delete, truncate on public.approvals, public.comments, public.rewrite_requests from authenticated;

create policy approvals_admin_select on public.approvals for select to authenticated
  using (private.is_admin() and company_id = private.current_company_id());
create policy comments_admin_select on public.comments for select to authenticated
  using (private.is_admin() and company_id = private.current_company_id());
create policy rewrite_requests_admin_select on public.rewrite_requests for select to authenticated
  using (private.is_admin() and company_id = private.current_company_id());

-- ---------------------------------------------------------------------------
-- Generation runs started by the system or a founder (D-32)
-- ---------------------------------------------------------------------------

-- Like request_generation, but the cost reserved is fixed here, not passed
-- in by the caller, and the model is taken from the draft's own history.
create function private.system_run(
  p_company uuid,
  p_kind public.generation_kind,
  p_founder_id uuid,
  p_month date,
  p_requested_by uuid,
  p_provider text,
  p_model text,
  p_template text,
  p_params jsonb,
  p_reserve numeric,
  p_key text
) returns public.generation_runs
language plpgsql security definer set search_path = '' as $$
declare
  v_settings public.settings;
  v_spent numeric;
  v_status public.generation_status := 'queued';
  v_message text;
  v_run public.generation_runs;
begin
  perform 1 from public.settings where company_id = p_company for update;
  select * into v_settings from public.settings where company_id = p_company;
  select * into v_run from public.generation_runs where company_id = p_company and idempotency_key = p_key;
  if found then
    return v_run;
  end if;
  v_spent := private.ai_spend_this_month(p_company);
  if p_reserve > v_settings.ai_per_run_ceiling_usd then
    v_status := 'refused';
    v_message := format('This run reserves $%s, over the $%s per-run ceiling.', p_reserve, v_settings.ai_per_run_ceiling_usd);
  elsif v_spent + p_reserve > v_settings.ai_monthly_budget_usd then
    v_status := 'refused';
    v_message := format('The monthly AI budget ($%s) does not have room for this run.', v_settings.ai_monthly_budget_usd);
  end if;
  insert into public.generation_runs (
    company_id, kind, founder_id, target_month, requested_by, provider, model, prompt_template,
    prompt_template_version, params, status, idempotency_key, estimated_cost_usd, error_code, error_message, finished_at
  ) values (
    p_company, p_kind, p_founder_id, p_month, p_requested_by, p_provider, p_model, p_template, 1, p_params,
    v_status, p_key, p_reserve, case when v_status = 'refused' then 'budget' end, v_message,
    case when v_status = 'refused' then now() end
  ) returning * into v_run;
  perform private.log_event(p_company, 'generation.' || v_status::text, 'generation_run', v_run.id,
    jsonb_build_object('kind', p_kind, 'founder_id', p_founder_id, 'reserved_usd', p_reserve), 'system');
  return v_run;
end;
$$;

-- The runner records the inputs of a run it resolved itself (rewrites).
create function public.set_run_input_refs(p_run_id uuid, p_refs jsonb) returns void
language sql security definer set search_path = '' as $$
  update public.generation_runs set input_refs = p_refs where id = p_run_id and status = 'running';
$$;

-- A failed rewrite marks its request failed.
create function private.rewrite_run_finished() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.kind = 'rewrite' and new.status in ('failed', 'refused', 'cancelled') then
    update public.rewrite_requests set status = 'failed', completed_at = now()
    where generation_run_id = new.id and status = 'requested';
  end if;
  return new;
end;
$$;
create trigger generation_runs_rewrite_finished after insert or update of status on public.generation_runs
  for each row execute function private.rewrite_run_finished();

-- complete_draft_run, extended for founders' rewrite requests.
create or replace function public.complete_draft_run(p_run_id uuid, p_served_model text, p_usage jsonb, p_payload jsonb)
returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_run public.generation_runs;
  v_concept public.concepts;
  v_draft public.drafts;
  v_version uuid;
begin
  select * into v_run from public.generation_runs where id = p_run_id and status = 'running' for update;
  if not found then
    raise exception 'run is not running' using errcode = '22023';
  end if;

  if v_run.kind = 'draft' then
    select * into v_concept from public.concepts
    where id = (v_run.params ->> 'concept_id')::uuid and company_id = v_run.company_id for update;
    if not found or v_concept.status not in ('selected', 'drafted') then
      raise exception 'the concept is no longer selected' using errcode = '22023';
    end if;
    insert into public.drafts (company_id, founder_id, concept_id, target_month, brief_version_id, status,
      generation_run_id, created_by)
    values (v_run.company_id, v_concept.founder_id, v_concept.id, v_concept.target_month,
      (v_run.input_refs ->> 'brief_version_id')::uuid, 'admin_review', v_run.id, v_run.requested_by)
    returning * into v_draft;
    update public.concepts set status = 'drafted' where id = v_concept.id and status = 'selected';
  elsif v_run.kind in ('draft_regen', 'rewrite') then
    select * into v_draft from public.drafts
    where id = (v_run.params ->> 'draft_id')::uuid and company_id = v_run.company_id for update;
    if not found or (v_run.kind = 'draft_regen' and v_draft.status not in ('drafting', 'admin_review'))
       or (v_run.kind = 'rewrite' and v_draft.status not in ('founder_review', 'changes_requested', 'approved')) then
      raise exception 'the draft can no longer be regenerated' using errcode = '22023';
    end if;
  else
    raise exception 'not a draft run' using errcode = '22023';
  end if;

  v_version := private.insert_draft_version(
    v_draft, p_payload ->> 'body',
    array(select jsonb_array_elements_text(coalesce(p_payload -> 'alternative_hooks', '[]'::jsonb))),
    null, 'ai', null, v_run.id, p_payload ->> 'rationale',
    nullif(v_run.input_refs ->> 'voice_profile_version_id', '')::uuid, p_payload -> 'fingerprint',
    coalesce(v_run.params ->> 'guidance', ''), p_payload -> 'claims', p_payload -> 'flags', p_payload -> 'checks', null);

  if v_run.kind = 'rewrite' then
    -- The founder reviews the rewrite. (A material change has already
    -- invalidated any approval, through the version trigger.)
    update public.drafts set status = 'founder_review' where id = v_draft.id;
    update public.rewrite_requests set status = 'completed', resulting_version_id = v_version, completed_at = now()
    where generation_run_id = v_run.id;
  end if;

  update public.generation_runs
  set status = 'succeeded', finished_at = now(), served_model = p_served_model,
      input_tokens = input_tokens + coalesce((p_usage ->> 'input_tokens')::integer, 0),
      output_tokens = output_tokens + coalesce((p_usage ->> 'output_tokens')::integer, 0),
      cache_read_tokens = cache_read_tokens + coalesce((p_usage ->> 'cache_read_tokens')::integer, 0),
      cache_write_tokens = cache_write_tokens + coalesce((p_usage ->> 'cache_write_tokens')::integer, 0),
      actual_cost_usd = coalesce(actual_cost_usd, 0) + coalesce((p_usage ->> 'cost_usd')::numeric, 0)
  where id = p_run_id;
  perform private.log_event(v_run.company_id, 'draft.version_generated', 'draft', v_draft.id,
    jsonb_build_object('run_id', v_run.id, 'kind', v_run.kind), 'system');
  return v_version;
end;
$$;

-- Feedback signals proposed by the system from a founder's edits (Phase 7).
create function public.complete_feedback_run(p_run_id uuid, p_served_model text, p_usage jsonb, p_signals jsonb)
returns integer
language plpgsql security definer set search_path = '' as $$
declare
  v_run public.generation_runs;
  v_count integer;
begin
  select * into v_run from public.generation_runs
  where id = p_run_id and status = 'running' and kind = 'feedback_classification' for update;
  if not found then
    raise exception 'run is not a running feedback classification' using errcode = '22023';
  end if;
  insert into public.feedback_signals (company_id, founder_id, draft_version_id, kind, format, statement, proposed_by)
  select v_run.company_id, v_run.founder_id, (v_run.params ->> 'version_id')::uuid,
    (s ->> 'kind')::public.feedback_kind,
    case when s ->> 'kind' = 'format_preference' then (s ->> 'format')::public.post_format end,
    left(btrim(s ->> 'statement'), 1000), 'system'
  from jsonb_array_elements(coalesce(p_signals, '[]'::jsonb)) s
  where length(btrim(coalesce(s ->> 'statement', ''))) > 0
    and (s ->> 'kind' <> 'format_preference' or s ->> 'format' is not null);
  get diagnostics v_count = row_count;
  update public.generation_runs
  set status = 'succeeded', finished_at = now(), served_model = p_served_model,
      input_tokens = input_tokens + coalesce((p_usage ->> 'input_tokens')::integer, 0),
      output_tokens = output_tokens + coalesce((p_usage ->> 'output_tokens')::integer, 0),
      actual_cost_usd = coalesce(actual_cost_usd, 0) + coalesce((p_usage ->> 'cost_usd')::numeric, 0)
  where id = p_run_id;
  return v_count;
end;
$$;

-- ---------------------------------------------------------------------------
-- Admin: share, return, edit, state changes
-- ---------------------------------------------------------------------------

-- Shares the current version with its founder and chooses which of its flags
-- they see. Allowed from admin review or after the founder asked for changes.
create function public.share_draft(p_draft_id uuid, p_visible_flag_ids uuid[]) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_company uuid := private.require_admin();
  v_draft public.drafts;
begin
  select * into v_draft from public.drafts where id = p_draft_id and company_id = v_company for update;
  if not found then
    raise exception 'draft not found' using errcode = 'P0002';
  end if;
  if v_draft.status not in ('admin_review', 'changes_requested') then
    raise exception 'a % draft cannot be shared', v_draft.status using errcode = '22023';
  end if;
  if not exists (
    select 1 from public.founders f join public.profiles p on p.user_id = f.user_id
    where f.id = v_draft.founder_id and p.status = 'active'
  ) then
    raise exception 'this founder has not accepted their invitation yet' using errcode = '22023';
  end if;
  -- Repetition flags quote other drafts, possibly another founder's: never shared.
  update public.review_flags
  set visible_to_founder = id = any (coalesce(p_visible_flag_ids, '{}')) and source <> 'repetition'
  where draft_version_id = v_draft.current_version_id;
  update public.drafts set status = 'founder_review', shared_with_founder_at = now() where id = p_draft_id;
  perform private.log_event(v_company, 'draft.shared', 'draft', p_draft_id,
    jsonb_build_object('version_id', v_draft.current_version_id, 'visible_flags', cardinality(coalesce(p_visible_flag_ids, '{}'))));
end;
$$;

-- The draft state machine for the admin (PRODUCT_SPEC §7.1). Sharing is
-- share_draft; approval is only ever the founder's (approve_draft).
-- Moving an approved draft anywhere withdraws its approval.
create or replace function public.transition_draft(p_draft_id uuid, p_to public.draft_status, p_reason text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_company uuid := private.require_admin();
  v_from public.draft_status;
begin
  select status into v_from from public.drafts where id = p_draft_id and company_id = v_company for update;
  if not found then
    raise exception 'draft not found' using errcode = 'P0002';
  end if;
  if not (
    (v_from = 'drafting' and p_to in ('admin_review', 'rejected', 'archived'))
    or (v_from = 'admin_review' and p_to in ('drafting', 'rejected', 'archived'))
    or (v_from in ('founder_review', 'changes_requested') and p_to in ('admin_review', 'rejected', 'archived'))
    or (v_from = 'approved' and p_to in ('admin_review', 'rejected', 'archived'))
    or (v_from = 'archived' and p_to = 'admin_review')
  ) then
    raise exception 'a % draft cannot become %', v_from, p_to using errcode = '22023';
  end if;
  if v_from = 'approved' then
    update public.approvals set invalidated_at = now(), invalidated_reason = 'withdrawn by the admin'
    where draft_id = p_draft_id and decision = 'approved' and invalidated_at is null;
  end if;
  update public.drafts set status = p_to where id = p_draft_id;
  perform private.log_event(v_company, 'draft.' || p_to::text, 'draft', p_draft_id,
    jsonb_build_object('from', v_from, 'reason', left(coalesce(p_reason, ''), 200)));
end;
$$;

-- Admin edits, now also on shared and approved drafts. A material change to an
-- approved draft invalidates the approval (trigger) and returns it to admin review.
-- Decisions on flags that are raised again carry over (D-32).
create or replace function public.save_draft_version(
  p_draft_id uuid,
  p_body text,
  p_alternative_hooks text[],
  p_selected_hook_index smallint,
  p_change_note text,
  p_claims jsonb,
  p_flags jsonb
) returns integer
language plpgsql security definer set search_path = '' as $$
declare
  v_company uuid := private.require_admin();
  v_draft public.drafts;
  v_current public.draft_versions;
  v_version uuid;
begin
  select * into v_draft from public.drafts where id = p_draft_id and company_id = v_company for update;
  if not found then
    raise exception 'draft not found' using errcode = 'P0002';
  end if;
  if v_draft.status not in ('drafting', 'admin_review', 'founder_review', 'changes_requested', 'approved') then
    raise exception 'a % draft cannot be edited', v_draft.status using errcode = '22023';
  end if;
  select * into v_current from public.draft_versions where id = v_draft.current_version_id;
  if p_selected_hook_index is not null and p_selected_hook_index >= cardinality(coalesce(p_alternative_hooks, '{}')) then
    raise exception 'no such hook' using errcode = '22023';
  end if;
  v_version := private.insert_draft_version(
    v_draft, p_body, p_alternative_hooks, p_selected_hook_index, 'admin', auth.uid(), null, v_current.rationale,
    v_current.voice_profile_version_id, v_current.fingerprint, p_change_note, p_claims, p_flags, null,
    v_current.id);
  -- A flag raised again for the same reason (same kind, source and message,
  -- e.g. a claim still in the text) keeps the decision already made on it,
  -- and stays shared with the founder if it was.
  update public.review_flags n
  set status = o.status, resolved_by = o.resolved_by, resolved_at = o.resolved_at, resolution_note = o.resolution_note,
      visible_to_founder = o.visible_to_founder
  from public.review_flags o
  where n.draft_version_id = v_version and o.draft_version_id = v_current.id
    and n.kind = o.kind and n.source = o.source and n.message = o.message and n.source <> 'placeholder'
    and (o.status <> 'open' or o.visible_to_founder);
  perform private.log_event(v_company, 'draft.version_saved', 'draft', p_draft_id,
    jsonb_build_object('version_id', v_version));
  return (select version_no from public.draft_versions where id = v_version);
end;
$$;

-- ---------------------------------------------------------------------------
-- Comments (admin and founder)
-- ---------------------------------------------------------------------------

-- The founder's own draft, shared and in a founder-visible status, locked.
create function private.founder_draft(p_draft_id uuid) returns public.drafts
language plpgsql security definer set search_path = '' as $$
declare
  v_draft public.drafts;
begin
  select * into v_draft from public.drafts
  where id = p_draft_id and founder_id = private.current_founder_id()
    and shared_with_founder_at is not null and private.founder_visible(status)
  for update;
  if not found then
    raise exception 'draft not found' using errcode = 'P0002';
  end if;
  return v_draft;
end;
$$;

create function public.add_comment(p_draft_id uuid, p_body text, p_quote text, p_visibility public.comment_visibility)
returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_admin boolean := private.is_admin();
  v_draft public.drafts;
  v_id uuid;
begin
  if v_admin then
    select * into v_draft from public.drafts where id = p_draft_id and company_id = private.current_company_id();
    if not found then
      raise exception 'draft not found' using errcode = 'P0002';
    end if;
  else
    v_draft := private.founder_draft(p_draft_id);
    if p_visibility <> 'shared' then
      raise exception 'founders can only write shared comments' using errcode = '42501';
    end if;
  end if;
  insert into public.comments (company_id, draft_id, draft_version_id, author_user_id, author_role, body, anchor, visibility)
  values (v_draft.company_id, v_draft.id, v_draft.current_version_id, auth.uid(),
    case when v_admin then 'admin' else 'founder' end::public.user_role, btrim(p_body),
    case when length(btrim(coalesce(p_quote, ''))) > 0 then jsonb_build_object('quote', left(btrim(p_quote), 500)) end,
    p_visibility)
  returning id into v_id;
  perform private.log_event(v_draft.company_id, 'comment.added', 'draft', v_draft.id,
    jsonb_build_object('comment_id', v_id, 'visibility', p_visibility));
  return v_id;
end;
$$;

create function public.resolve_comment(p_comment_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_comment public.comments;
begin
  select * into v_comment from public.comments where id = p_comment_id for update;
  if not found then
    raise exception 'comment not found' using errcode = 'P0002';
  end if;
  if private.is_admin() then
    if v_comment.company_id <> private.current_company_id() then
      raise exception 'comment not found' using errcode = 'P0002';
    end if;
  else
    perform private.founder_draft(v_comment.draft_id);
    if v_comment.visibility <> 'shared' then
      raise exception 'comment not found' using errcode = 'P0002';
    end if;
  end if;
  update public.comments set resolved_at = now(), resolved_by = auth.uid() where id = p_comment_id and resolved_at is null;
end;
$$;

-- ---------------------------------------------------------------------------
-- Founder: read
-- ---------------------------------------------------------------------------

create function public.founder_drafts()
returns table (id uuid, title text, status public.draft_status, version_no integer, shared_at timestamptz,
  updated_at timestamptz, target_month date, approved boolean)
language sql stable security definer set search_path = '' as $$
  select d.id, coalesce(c.title, 'Untitled draft'), d.status, v.version_no, d.shared_with_founder_at, d.updated_at,
    d.target_month, (private.valid_approval(d.id)).id is not null
  from public.drafts d
  join public.draft_versions v on v.id = d.current_version_id
  left join public.concepts c on c.id = d.concept_id
  where d.founder_id = private.current_founder_id()
    and d.shared_with_founder_at is not null and private.founder_visible(d.status)
  order by d.updated_at desc;
$$;

-- Every version of one of the founder's shared drafts, without the internal
-- rationale.
create function public.founder_draft_versions(p_draft_id uuid)
returns table (id uuid, version_no integer, body text, alternative_hooks text[], selected_hook_index smallint,
  author_kind public.draft_author_kind, change_note text, created_at timestamptz, is_current boolean,
  placeholder_count integer)
language sql stable security definer set search_path = '' as $$
  select v.id, v.version_no, v.body, v.alternative_hooks, v.selected_hook_index, v.author_kind, v.change_note,
    v.created_at, v.id = d.current_version_id, v.placeholder_count
  from public.drafts d join public.draft_versions v on v.draft_id = d.id
  where d.id = p_draft_id and d.founder_id = private.current_founder_id()
    and d.shared_with_founder_at is not null and private.founder_visible(d.status)
  order by v.version_no desc;
$$;

-- The flags of the current version that the admin shared, plus every open
-- blocking flag (the founder must know why they can't approve yet).
create function public.founder_draft_flags(p_draft_id uuid)
returns table (id uuid, kind public.flag_kind, severity public.flag_severity, message text, quote text,
  status public.flag_status)
language sql stable security definer set search_path = '' as $$
  select f.id, f.kind, f.severity, f.message,
    case when f.span_start is not null then substr(v.body, f.span_start + 1, f.span_end - f.span_start) end,
    f.status
  from public.drafts d
  join public.draft_versions v on v.id = d.current_version_id
  join public.review_flags f on f.draft_version_id = v.id
  where d.id = p_draft_id and d.founder_id = private.current_founder_id()
    and d.shared_with_founder_at is not null and private.founder_visible(d.status)
    and (f.visible_to_founder or (f.severity = 'blocking' and f.status = 'open'))
    -- They quote other drafts, possibly another founder's.
    and f.source <> 'repetition'
  order by f.severity, f.created_at;
$$;

create function public.founder_comments(p_draft_id uuid)
returns table (id uuid, body text, quote text, author_role public.user_role, version_no integer,
  created_at timestamptz, resolved boolean)
language sql stable security definer set search_path = '' as $$
  select c.id, c.body, c.anchor ->> 'quote', c.author_role, v.version_no, c.created_at, c.resolved_at is not null
  from public.drafts d
  join public.comments c on c.draft_id = d.id
  join public.draft_versions v on v.id = c.draft_version_id
  where d.id = p_draft_id and d.founder_id = private.current_founder_id()
    and d.shared_with_founder_at is not null and private.founder_visible(d.status)
    and c.visibility = 'shared'
  order by c.created_at;
$$;

create function public.founder_rewrite_requests(p_draft_id uuid)
returns table (id uuid, instructions text, status public.rewrite_status, created_at timestamptz)
language sql stable security definer set search_path = '' as $$
  select r.id, r.instructions, r.status, r.created_at
  from public.drafts d join public.rewrite_requests r on r.draft_id = d.id
  where d.id = p_draft_id and d.founder_id = private.current_founder_id()
    and d.shared_with_founder_at is not null and private.founder_visible(d.status)
  order by r.created_at desc;
$$;

-- ---------------------------------------------------------------------------
-- Founder: edit, approve, request changes, reject, rewrite
-- ---------------------------------------------------------------------------

-- A founder's edit. Flags are worked out here, not taken from the caller:
-- placeholders are found in the new text; every other open or decided flag
-- carries over while the words it is about are still in the text.
create function public.founder_save_version(p_draft_id uuid, p_body text, p_change_note text) returns integer
language plpgsql security definer set search_path = '' as $$
declare
  v_draft public.drafts := private.founder_draft(p_draft_id);
  v_current public.draft_versions;
  v_version uuid;
  v_flags jsonb;
  v_claims jsonb;
begin
  if v_draft.status not in ('founder_review', 'changes_requested', 'approved') then
    raise exception 'a % draft cannot be edited', v_draft.status using errcode = '22023';
  end if;
  if length(trim(coalesce(p_body, ''))) = 0 or length(p_body) > 6000 then
    raise exception 'the post must be 1 to 6,000 characters' using errcode = '22023';
  end if;
  select * into v_current from public.draft_versions where id = v_draft.current_version_id;

  select coalesce(jsonb_agg(jsonb_build_object(
    'kind', 'needs_personal_context', 'severity', 'blocking', 'source', 'placeholder',
    'message', 'Founder to supply: ' || coalesce(nullif(btrim(m[1]), ''), 'personal context'))), '[]'::jsonb)
  into v_flags
  from regexp_matches(p_body, '\[FOUNDER TO SUPPLY:\s*([^\]]*)\]', 'g') m;

  select coalesce(jsonb_agg(jsonb_build_object('claim_text', c.claim_text, 'claim_kind', c.claim_kind,
    'span_start', nullif(position(lower(c.claim_text) in lower(p_body)), 0) - 1,
    'span_end', nullif(position(lower(c.claim_text) in lower(p_body)), 0) - 1 + length(c.claim_text),
    'approved_fact', c.approved_fact, 'support_status', c.support_status)), '[]'::jsonb)
  into v_claims
  from public.draft_claims c
  where c.draft_version_id = v_current.id and position(lower(c.claim_text) in lower(p_body)) > 0;

  v_version := private.insert_draft_version(
    v_draft, p_body, v_current.alternative_hooks, v_current.selected_hook_index, 'founder', auth.uid(), null,
    v_current.rationale,
    v_current.voice_profile_version_id, v_current.fingerprint, p_change_note, v_claims, v_flags, null, null);

  insert into public.review_flags (draft_version_id, company_id, kind, severity, source, message, span_start, span_end,
    compared_type, compared_id, status, resolved_by, resolved_at, resolution_note, visible_to_founder)
  select v_version, f.company_id, f.kind, f.severity, f.source, f.message,
    nullif(position(substr(v_current.body, f.span_start + 1, f.span_end - f.span_start) in p_body), 0) - 1,
    nullif(position(substr(v_current.body, f.span_start + 1, f.span_end - f.span_start) in p_body), 0) - 1
      + (f.span_end - f.span_start),
    f.compared_type, f.compared_id, f.status, f.resolved_by, f.resolved_at, f.resolution_note, f.visible_to_founder
  from public.review_flags f
  where f.draft_version_id = v_current.id and f.source <> 'placeholder'
    and (f.span_start is null
      or position(substr(v_current.body, f.span_start + 1, f.span_end - f.span_start) in p_body) > 0);

  -- An edit in founder review stays there; after "changes requested" the
  -- founder's own edit puts it back in front of them. (An edit to an approved
  -- draft was already returned to founder review by the material-edit trigger.)
  update public.drafts set status = 'founder_review' where id = v_draft.id and status = 'changes_requested';
  perform private.log_event(v_draft.company_id, 'draft.founder_edited', 'draft', v_draft.id,
    jsonb_build_object('version_id', v_version));
  return (select version_no from public.draft_versions where id = v_version);
end;
$$;

-- The founder approves the exact version they are looking at (D-11). Refused
-- while any blocking flag is open or a placeholder remains. A person must
-- approve: clean flags alone never do. If the founder edited the draft, the
-- system proposes feedback signals from their edits (admin reviews them).
create function public.approve_draft(p_draft_id uuid, p_version_id uuid, p_note text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_draft public.drafts := private.founder_draft(p_draft_id);
  v_version public.draft_versions;
  v_approval uuid;
  v_origin public.generation_runs;
  v_before uuid;
  v_seen integer;
  v_first_edit integer;
begin
  if v_draft.status <> 'founder_review' then
    raise exception 'only a draft in founder review can be approved' using errcode = '22023';
  end if;
  if p_version_id is distinct from v_draft.current_version_id then
    raise exception 'the draft changed since you opened it; review the latest version' using errcode = '40001';
  end if;
  select * into v_version from public.draft_versions where id = v_draft.current_version_id;
  if v_version.placeholder_count > 0 then
    raise exception 'replace every [FOUNDER TO SUPPLY] placeholder first' using errcode = '22023';
  end if;
  if exists (select 1 from public.review_flags where draft_version_id = v_version.id
             and severity = 'blocking' and status = 'open') then
    raise exception 'a blocking flag is still open' using errcode = '22023';
  end if;

  insert into public.approvals (company_id, draft_id, draft_version_id, body_hash, selected_hook, approver_user_id,
    approver_role, decision, note)
  values (v_draft.company_id, v_draft.id, v_version.id, v_version.body_normalized_hash,
    private.selected_hook(v_version), auth.uid(), 'founder', 'approved', left(btrim(coalesce(p_note, '')), 1000))
  returning id into v_approval;
  update public.drafts set status = 'approved' where id = v_draft.id;
  perform private.log_event(v_draft.company_id, 'draft.approved', 'draft', v_draft.id,
    jsonb_build_object('approval_id', v_approval, 'version_id', v_version.id));

  -- Feedback from the founder's edits not yet classified: compare the version
  -- before their first such edit with what they approved.
  select coalesce(max(v.version_no), 0) into v_seen
  from public.generation_runs r join public.draft_versions v on v.id = (r.params ->> 'version_id')::uuid
  where r.kind = 'feedback_classification' and r.company_id = v_draft.company_id
    and r.params ->> 'draft_id' = v_draft.id::text;
  select min(version_no) into v_first_edit from public.draft_versions
  where draft_id = v_draft.id and author_kind = 'founder' and version_no > v_seen;
  if v_first_edit is not null then
    select id into v_before from public.draft_versions
    where draft_id = v_draft.id and author_kind <> 'founder' and version_no < v_first_edit
    order by version_no desc limit 1;
    select * into v_origin from public.generation_runs where id = v_draft.generation_run_id;
    if v_before is not null then
      perform private.system_run(v_draft.company_id, 'feedback_classification', v_draft.founder_id, v_draft.target_month,
        auth.uid(), coalesce(v_origin.provider, 'fake'),
        coalesce(v_origin.params ->> 'judge_model', 'claude-sonnet-5-5'), 'feedback', jsonb_build_object(
          'draft_id', v_draft.id, 'before_version_id', v_before, 'version_id', v_version.id),
        0.10, 'feedback:' || v_approval::text);
    end if;
  end if;
  return v_approval;
end;
$$;

-- The founder takes back their approval (e.g. to edit after all).
create function public.revoke_approval(p_draft_id uuid, p_reason text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_draft public.drafts := private.founder_draft(p_draft_id);
begin
  if v_draft.status <> 'approved' then
    raise exception 'the draft is not approved' using errcode = '22023';
  end if;
  update public.approvals
  set invalidated_at = now(), invalidated_reason = left('revoked by the founder: ' || coalesce(p_reason, ''), 300)
  where draft_id = v_draft.id and decision = 'approved' and invalidated_at is null;
  update public.drafts set status = 'founder_review' where id = v_draft.id;
  perform private.log_event(v_draft.company_id, 'approval.revoked', 'draft', v_draft.id);
end;
$$;

create function public.request_changes(p_draft_id uuid, p_comment text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_draft public.drafts := private.founder_draft(p_draft_id);
begin
  if v_draft.status <> 'founder_review' then
    raise exception 'only a draft in founder review can be returned' using errcode = '22023';
  end if;
  if length(btrim(coalesce(p_comment, ''))) > 0 then
    perform public.add_comment(p_draft_id, p_comment, null, 'shared');
  end if;
  update public.drafts set status = 'changes_requested' where id = v_draft.id;
  perform private.log_event(v_draft.company_id, 'draft.changes_requested', 'draft', v_draft.id);
end;
$$;

create function public.founder_reject_draft(p_draft_id uuid, p_note text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_draft public.drafts := private.founder_draft(p_draft_id);
begin
  if v_draft.status not in ('founder_review', 'changes_requested') then
    raise exception 'a % draft cannot be rejected here', v_draft.status using errcode = '22023';
  end if;
  insert into public.approvals (company_id, draft_id, draft_version_id, body_hash, selected_hook, approver_user_id,
    approver_role, decision, note)
  select v_draft.company_id, v_draft.id, v.id, v.body_normalized_hash, private.selected_hook(v), auth.uid(), 'founder',
    'rejected',
    left(btrim(coalesce(p_note, '')), 1000)
  from public.draft_versions v where v.id = v_draft.current_version_id;
  update public.drafts set status = 'rejected' where id = v_draft.id;
  perform private.log_event(v_draft.company_id, 'draft.rejected_by_founder', 'draft', v_draft.id);
end;
$$;

-- A founder's rewrite request: an AI run with their instructions, producing a
-- new version (nothing is overwritten). At most 10 a day per founder
-- (SECURITY §10). The run reserves the full per-run ceiling (D-32).
create function public.request_rewrite(p_draft_id uuid, p_instructions text, p_idempotency_key text)
returns table (request_id uuid, run_id uuid, run_status public.generation_status, message text)
language plpgsql security definer set search_path = '' as $$
declare
  v_draft public.drafts := private.founder_draft(p_draft_id);
  v_origin public.generation_runs;
  v_ceiling numeric;
  v_run public.generation_runs;
  v_request uuid;
begin
  if v_draft.status not in ('founder_review', 'changes_requested', 'approved') then
    raise exception 'a % draft cannot be rewritten', v_draft.status using errcode = '22023';
  end if;
  if length(btrim(coalesce(p_instructions, ''))) = 0 or length(p_instructions) > 1000 then
    raise exception 'say what the rewrite should change (up to 1,000 characters)' using errcode = '22023';
  end if;
  if v_draft.concept_id is null then
    raise exception 'this draft has no concept to rewrite from' using errcode = '22023';
  end if;
  if (select count(*) from public.rewrite_requests r join public.drafts d on d.id = r.draft_id
      where d.founder_id = v_draft.founder_id and r.created_at > now() - interval '1 day') >= 10 then
    raise exception 'you can request up to 10 rewrites a day' using errcode = '22023';
  end if;
  select * into v_origin from public.generation_runs where id = v_draft.generation_run_id;
  select ai_per_run_ceiling_usd into v_ceiling from public.settings where company_id = v_draft.company_id;
  v_run := private.system_run(v_draft.company_id, 'rewrite', v_draft.founder_id, v_draft.target_month, auth.uid(),
    coalesce(v_origin.provider, 'fake'), coalesce(v_origin.model, 'claude-opus-5-5'), 'draft',
    jsonb_build_object('draft_id', v_draft.id, 'concept_id', v_draft.concept_id, 'guidance', btrim(p_instructions),
      'judge_model', coalesce(v_origin.params ->> 'judge_model', 'claude-sonnet-5-5')),
    v_ceiling, 'rewrite:' || v_draft.id::text || ':' || left(coalesce(p_idempotency_key, ''), 100));
  select id into v_request from public.rewrite_requests where generation_run_id = v_run.id;
  if v_request is null then
    insert into public.rewrite_requests (company_id, draft_id, requested_by, instructions, status, generation_run_id,
      completed_at)
    values (v_draft.company_id, v_draft.id, auth.uid(), btrim(p_instructions),
      case when v_run.status = 'refused' then 'failed' else 'requested' end::public.rewrite_status, v_run.id,
      case when v_run.status = 'refused' then now() end)
    returning id into v_request;
  end if;
  return query select v_request, v_run.id, v_run.status, v_run.error_message;
end;
$$;

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------

revoke all on function
  private.founder_visible(public.draft_status), private.selected_hook(public.draft_versions), private.approvals_guard(), private.valid_approval(uuid),
  private.invalidate_on_material_edit(), private.system_run(uuid, public.generation_kind, uuid, date, uuid, text, text, text, jsonb, numeric, text),
  private.rewrite_run_finished(), private.founder_draft(uuid)
from public, anon, authenticated;
grant execute on function private.founder_visible(public.draft_status) to authenticated;

revoke all on function
  public.share_draft(uuid, uuid[]), public.add_comment(uuid, text, text, public.comment_visibility),
  public.resolve_comment(uuid), public.founder_drafts(), public.founder_draft_versions(uuid),
  public.founder_draft_flags(uuid), public.founder_comments(uuid), public.founder_rewrite_requests(uuid),
  public.founder_save_version(uuid, text, text), public.approve_draft(uuid, uuid, text),
  public.revoke_approval(uuid, text), public.request_changes(uuid, text), public.founder_reject_draft(uuid, text),
  public.request_rewrite(uuid, text, text)
from public, anon;
grant execute on function
  public.share_draft(uuid, uuid[]), public.add_comment(uuid, text, text, public.comment_visibility),
  public.resolve_comment(uuid), public.founder_drafts(), public.founder_draft_versions(uuid),
  public.founder_draft_flags(uuid), public.founder_comments(uuid), public.founder_rewrite_requests(uuid),
  public.founder_save_version(uuid, text, text), public.approve_draft(uuid, uuid, text),
  public.revoke_approval(uuid, text), public.request_changes(uuid, text), public.founder_reject_draft(uuid, text),
  public.request_rewrite(uuid, text, text)
to authenticated;

revoke all on function public.set_run_input_refs(uuid, jsonb), public.complete_feedback_run(uuid, text, jsonb, jsonb)
from public, anon, authenticated;
grant execute on function public.set_run_input_refs(uuid, jsonb), public.complete_feedback_run(uuid, text, jsonb, jsonb)
to service_role;
