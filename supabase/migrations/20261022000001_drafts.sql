-- Phase 4b: drafts, immutable draft versions, claims, review flags and
-- repetition checks. See docs/PRODUCT_SPEC.md §5.3, §5.6, §5.7, §6, §7 and
-- docs/DATA_MODEL.md §7.
--
-- Flags are computed in TypeScript (lib/domain/draft-review.ts) and stored
-- per version, so old flags never silently apply to new text. Founders get
-- access to their own shared drafts in Phase 7; until then drafts are
-- admin-only.

create extension if not exists pg_trgm with schema extensions;

create type public.draft_status as enum (
  'drafting', 'admin_review', 'founder_review', 'changes_requested', 'approved', 'scheduled', 'published',
  'rejected', 'archived'
);
create type public.draft_author_kind as enum ('ai', 'admin', 'founder');
create type public.claim_kind as enum ('sourced_fact', 'opinion', 'interpretation', 'founder_experience');
create type public.claim_support as enum ('supported', 'weak', 'unsupported', 'disputed', 'not_applicable');
create type public.flag_kind as enum (
  'unsupported_claim', 'weak_evidence', 'needs_personal_context', 'competitor_claim', 'product_claim', 'repetition',
  'sensitive_content', 'style'
);
create type public.flag_severity as enum ('blocking', 'warning', 'info');
create type public.flag_status as enum ('open', 'resolved', 'overridden');

-- ---------------------------------------------------------------------------
-- Body normalization (PRODUCT_SPEC §7.4). The TypeScript twin is
-- lib/domain/drafts.ts normalizeBody(); a test checks they agree.
-- Line endings to \n, trailing spaces and tabs removed from each line,
-- leading and trailing blank lines removed, Unicode NFC.
-- ---------------------------------------------------------------------------

create function private.normalize_body(p_body text) returns text
language sql immutable set search_path = '' as $$
  select normalize(
    regexp_replace(
      regexp_replace(
        regexp_replace(replace(replace(p_body, E'\r\n', E'\n'), E'\r', E'\n'), '[ \t]+$', '', 'gn'),
        '^\n+', ''),
      '\n+$', ''),
    NFC);
$$;

-- ---------------------------------------------------------------------------
-- Drafts and versions
-- ---------------------------------------------------------------------------

create table public.drafts (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id),
  founder_id uuid not null references public.founders (id) on delete cascade,
  concept_id uuid references public.concepts (id),
  target_month date not null check (extract(day from target_month) = 1),
  brief_version_id uuid not null references public.brief_versions (id),
  status public.draft_status not null default 'admin_review',
  current_version_id uuid,
  shared_with_founder_at timestamptz,
  proposed_date date,
  scheduled_for timestamptz,
  is_external boolean not null default false,
  superseded_by_draft_id uuid references public.drafts (id),
  generation_run_id uuid references public.generation_runs (id),
  created_by uuid references public.profiles (user_id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index drafts_founder_status_idx on public.drafts (founder_id, status);
create index drafts_month_idx on public.drafts (company_id, target_month);

create table public.draft_versions (
  id uuid primary key default gen_random_uuid(),
  draft_id uuid not null references public.drafts (id) on delete cascade,
  company_id uuid not null references public.companies (id),
  founder_id uuid not null references public.founders (id) on delete cascade,
  version_no integer not null check (version_no > 0),
  -- The LinkedIn post text only. LinkedIn's own limit (3,000) is a lint flag;
  -- this is a storage bound.
  body text not null check (length(trim(body)) between 1 and 6000),
  alternative_hooks text[] not null default '{}' check (cardinality(alternative_hooks) <= 6),
  selected_hook_index smallint check (selected_hook_index is null or selected_hook_index >= 0),
  -- Set by trigger from the body; any value passed in is replaced.
  body_normalized_hash bytea not null default ''::bytea,
  placeholder_count integer not null default 0,
  author_kind public.draft_author_kind not null,
  created_by uuid references public.profiles (user_id) on delete set null,
  generation_run_id uuid references public.generation_runs (id),
  parent_version_id uuid references public.draft_versions (id),
  -- Internal. Never shown to founders unless marked shared (Phase 7).
  rationale text not null default '' check (length(rationale) <= 4000),
  voice_profile_version_id uuid references public.voice_profile_versions (id),
  fingerprint jsonb not null default '{}'::jsonb check (jsonb_typeof(fingerprint) = 'object'),
  change_note text not null default '' check (length(change_note) <= 500),
  created_at timestamptz not null default now(),
  unique (draft_id, version_no),
  check (author_kind = 'ai' or created_by is not null or generation_run_id is null)
);
create index draft_versions_draft_idx on public.draft_versions (draft_id, version_no desc);
create index draft_versions_body_trgm_idx on public.draft_versions using gin (body extensions.gin_trgm_ops);

alter table public.drafts
  add constraint drafts_current_version_fk
  foreign key (current_version_id) references public.draft_versions (id) deferrable initially deferred;

create function private.set_version_derived() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.body_normalized_hash := sha256(convert_to(private.normalize_body(new.body), 'UTF8'));
  new.placeholder_count := (length(new.body) - length(replace(new.body, '[FOUNDER TO SUPPLY', '')))
    / length('[FOUNDER TO SUPPLY');
  return new;
end;
$$;
create trigger draft_versions_derived before insert on public.draft_versions
  for each row execute function private.set_version_derived();
create trigger draft_versions_immutable before update or delete on public.draft_versions
  for each row execute function private.reject_change();
create trigger drafts_touch before update on public.drafts
  for each row execute function private.touch_updated_at();

-- ---------------------------------------------------------------------------
-- Claims, flags, repetition checks (all per version)
-- ---------------------------------------------------------------------------

create table public.draft_claims (
  id uuid primary key default gen_random_uuid(),
  draft_version_id uuid not null references public.draft_versions (id) on delete cascade,
  company_id uuid not null references public.companies (id),
  claim_text text not null check (length(trim(claim_text)) between 1 and 1000),
  claim_kind public.claim_kind not null,
  span_start integer check (span_start >= 0),
  span_end integer check (span_end >= span_start),
  -- Research findings arrive in Phase 5; the foreign key comes with them.
  finding_id uuid,
  -- The approved fact from the brief that backs it, word for word.
  approved_fact text check (length(approved_fact) <= 1000),
  support_status public.claim_support not null
);
create index draft_claims_version_idx on public.draft_claims (draft_version_id);

create table public.review_flags (
  id uuid primary key default gen_random_uuid(),
  draft_version_id uuid not null references public.draft_versions (id) on delete cascade,
  company_id uuid not null references public.companies (id),
  kind public.flag_kind not null,
  severity public.flag_severity not null,
  -- Who raised it: the model, the lint, the placeholder or claim rules, or the repetition check.
  source text not null check (source in ('model', 'lint', 'placeholder', 'claims', 'repetition')),
  message text not null check (length(trim(message)) between 1 and 1000),
  span_start integer check (span_start >= 0),
  span_end integer check (span_end >= span_start),
  -- For repetition flags: what it repeats.
  compared_type text check (compared_type in ('draft', 'concept', 'published_post')),
  compared_id uuid,
  status public.flag_status not null default 'open',
  resolved_by uuid references public.profiles (user_id) on delete set null,
  resolved_at timestamptz,
  resolution_note text check (length(resolution_note) <= 500),
  visible_to_founder boolean not null default false,
  created_at timestamptz not null default now(),
  check ((status = 'open') = (resolved_at is null)),
  -- An override always records why.
  check (status <> 'overridden' or length(trim(coalesce(resolution_note, ''))) >= 5)
);
create index review_flags_version_idx on public.review_flags (draft_version_id, status);

create table public.repetition_checks (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id),
  subject_type text not null check (subject_type in ('concept', 'draft_version')),
  subject_id uuid not null,
  compared_type text not null check (compared_type in ('draft', 'concept', 'published_post')),
  compared_id uuid not null,
  method text not null check (method in ('fingerprint', 'trigram', 'llm', 'embedding')),
  score real,
  explanation text not null default '' check (length(explanation) <= 1000),
  created_at timestamptz not null default now()
);
create index repetition_checks_subject_idx on public.repetition_checks (subject_type, subject_id);

-- ---------------------------------------------------------------------------
-- Privileges and row-level security
-- ---------------------------------------------------------------------------

alter table public.drafts enable row level security;
alter table public.draft_versions enable row level security;
alter table public.draft_claims enable row level security;
alter table public.review_flags enable row level security;
alter table public.repetition_checks enable row level security;

revoke insert, update, delete, truncate on
  public.drafts, public.draft_versions, public.draft_claims, public.review_flags, public.repetition_checks
from authenticated;

-- Admin-only until founder review (Phase 7) adds the founder's shared-draft view.
create policy drafts_admin_select on public.drafts for select to authenticated
  using (private.is_admin() and company_id = private.current_company_id());
create policy draft_versions_admin_select on public.draft_versions for select to authenticated
  using (private.is_admin() and company_id = private.current_company_id());
create policy draft_claims_admin_select on public.draft_claims for select to authenticated
  using (private.is_admin() and company_id = private.current_company_id());
create policy review_flags_admin_select on public.review_flags for select to authenticated
  using (private.is_admin() and company_id = private.current_company_id());
create policy repetition_checks_admin_select on public.repetition_checks for select to authenticated
  using (private.is_admin() and company_id = private.current_company_id());

-- ---------------------------------------------------------------------------
-- Writing versions (internal)
-- ---------------------------------------------------------------------------

-- Inserts a version with its claims, flags and repetition checks, and makes
-- it current. p_carry_from: copy that version's model and repetition flags
-- (an admin edit keeps them; lint, placeholder and claim flags are recomputed).
create function private.insert_draft_version(
  p_draft public.drafts,
  p_body text,
  p_hooks text[],
  p_selected_hook smallint,
  p_author public.draft_author_kind,
  p_created_by uuid,
  p_run uuid,
  p_rationale text,
  p_voice uuid,
  p_fingerprint jsonb,
  p_change_note text,
  p_claims jsonb,
  p_flags jsonb,
  p_checks jsonb,
  p_carry_from uuid
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_id uuid;
  v_no integer;
begin
  perform 1 from public.drafts where id = p_draft.id for update;
  select coalesce(max(version_no), 0) + 1 into v_no from public.draft_versions where draft_id = p_draft.id;

  insert into public.draft_versions (
    draft_id, company_id, founder_id, version_no, body, alternative_hooks, selected_hook_index, author_kind,
    created_by, generation_run_id, parent_version_id, rationale, voice_profile_version_id, fingerprint, change_note
  ) values (
    p_draft.id, p_draft.company_id, p_draft.founder_id, v_no, p_body, coalesce(p_hooks, '{}'), p_selected_hook,
    p_author, p_created_by, p_run, p_draft.current_version_id, coalesce(p_rationale, ''), p_voice,
    coalesce(p_fingerprint, '{}'::jsonb), coalesce(p_change_note, '')
  ) returning id into v_id;

  insert into public.draft_claims (draft_version_id, company_id, claim_text, claim_kind, span_start, span_end,
    approved_fact, support_status)
  select v_id, p_draft.company_id, c ->> 'claim_text', (c ->> 'claim_kind')::public.claim_kind,
    (c ->> 'span_start')::integer, (c ->> 'span_end')::integer, c ->> 'approved_fact',
    (c ->> 'support_status')::public.claim_support
  from jsonb_array_elements(coalesce(p_claims, '[]'::jsonb)) c;

  insert into public.review_flags (draft_version_id, company_id, kind, severity, source, message, span_start, span_end,
    compared_type, compared_id)
  select v_id, p_draft.company_id, (f ->> 'kind')::public.flag_kind, (f ->> 'severity')::public.flag_severity,
    f ->> 'source', f ->> 'message', (f ->> 'span_start')::integer, (f ->> 'span_end')::integer,
    f ->> 'compared_type', (f ->> 'compared_id')::uuid
  from jsonb_array_elements(coalesce(p_flags, '[]'::jsonb)) f;

  if p_carry_from is not null then
    insert into public.review_flags (draft_version_id, company_id, kind, severity, source, message, compared_type,
      compared_id, status, resolved_by, resolved_at, resolution_note)
    select v_id, company_id, kind, severity, source, message, compared_type, compared_id, status, resolved_by,
      resolved_at, resolution_note
    from public.review_flags
    where draft_version_id = p_carry_from and source in ('model', 'repetition');
  end if;

  insert into public.repetition_checks (company_id, subject_type, subject_id, compared_type, compared_id, method,
    score, explanation)
  select p_draft.company_id, 'draft_version', v_id, r ->> 'compared_type', (r ->> 'compared_id')::uuid,
    r ->> 'method', (r ->> 'score')::real, coalesce(r ->> 'explanation', '')
  from jsonb_array_elements(coalesce(p_checks, '[]'::jsonb)) r;

  update public.drafts set current_version_id = v_id where id = p_draft.id;
  return v_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- Job runner (service_role only)
-- ---------------------------------------------------------------------------

-- Stores a generated draft (a new draft for a concept, or a new version of a
-- draft being regenerated) and marks the run succeeded, in one transaction.
create function public.complete_draft_run(p_run_id uuid, p_served_model text, p_usage jsonb, p_payload jsonb)
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
  elsif v_run.kind = 'draft_regen' then
    select * into v_draft from public.drafts
    where id = (v_run.params ->> 'draft_id')::uuid and company_id = v_run.company_id for update;
    if not found or v_draft.status not in ('drafting', 'admin_review') then
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

  update public.generation_runs
  set status = 'succeeded', finished_at = now(), served_model = p_served_model,
      input_tokens = input_tokens + coalesce((p_usage ->> 'input_tokens')::integer, 0),
      output_tokens = output_tokens + coalesce((p_usage ->> 'output_tokens')::integer, 0),
      cache_read_tokens = cache_read_tokens + coalesce((p_usage ->> 'cache_read_tokens')::integer, 0),
      cache_write_tokens = cache_write_tokens + coalesce((p_usage ->> 'cache_write_tokens')::integer, 0),
      actual_cost_usd = coalesce(actual_cost_usd, 0) + coalesce((p_usage ->> 'cost_usd')::numeric, 0)
  where id = p_run_id;
  perform private.log_event(v_run.company_id, 'draft.version_generated', 'draft', v_draft.id,
    jsonb_build_object('run_id', v_run.id), 'system');
  return v_version;
end;
$$;

-- ---------------------------------------------------------------------------
-- Repetition pre-filter (PRODUCT_SPEC §6, step 1)
-- ---------------------------------------------------------------------------

-- Live drafts, live concepts of the month, and published LinkedIn posts from
-- the last 180 days that share the argument key or have similar text.
-- Called by the runner (service_role) and by the admin's edit path.
create function public.repetition_candidates(
  p_company_id uuid,
  p_text text,
  p_argument_key text,
  p_month date,
  p_exclude_draft_id uuid,
  p_exclude_concept_id uuid
) returns table (compared_type text, compared_id uuid, founder_id uuid, excerpt text, similarity real, same_argument boolean)
language plpgsql stable security definer set search_path = '' as $$
declare
  v_key text := lower(btrim(coalesce(p_argument_key, '')));
begin
  if not (private.is_admin() and p_company_id = private.current_company_id())
     and coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'admin only' using errcode = '42501';
  end if;
  return query
  select * from (
    select 'draft'::text, d.id, d.founder_id, left(v.body, 300),
      extensions.similarity(v.body, p_text), v_key <> '' and lower(v.fingerprint ->> 'argument_key') = v_key
    from public.drafts d join public.draft_versions v on v.id = d.current_version_id
    where d.company_id = p_company_id and d.id is distinct from p_exclude_draft_id
      and d.status not in ('rejected', 'archived')
    union all
    select 'concept', c.id, c.founder_id, left(c.title || ': ' || c.core_argument, 300),
      extensions.similarity(c.title || ' ' || c.core_argument || ' ' || c.hook, p_text),
      v_key <> '' and lower(c.fingerprint ->> 'argument_key') = v_key
    from public.concepts c
    where c.company_id = p_company_id and c.target_month = p_month and c.id is distinct from p_exclude_concept_id
      and c.status in ('proposed', 'selected')
    union all
    select 'published_post', e.id, e.founder_id, left(e.body, 300), extensions.similarity(e.body, p_text), false
    from public.writing_examples e
    where e.company_id = p_company_id and e.kind = 'published_linkedin'
      and coalesce(e.published_at, e.created_at::date) >= current_date - 180
  ) candidates (compared_type, compared_id, founder_id, excerpt, similarity, same_argument)
  where candidates.similarity >= 0.35 or candidates.same_argument
  order by candidates.same_argument desc, candidates.similarity desc
  limit 5;
end;
$$;

-- ---------------------------------------------------------------------------
-- Admin actions
-- ---------------------------------------------------------------------------

-- A new version written by the admin. Lint, placeholder and claim flags are
-- recomputed by the caller (lib/domain/draft-review.ts); the model's and the
-- repetition check's flags carry over from the version it edits.
create function public.save_draft_version(
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
  -- Editing shared or approved drafts (and the approval invalidation it
  -- triggers) arrives with founder review in Phase 7.
  if v_draft.status not in ('drafting', 'admin_review') then
    raise exception 'a % draft cannot be edited yet', v_draft.status using errcode = '22023';
  end if;
  select * into v_current from public.draft_versions where id = v_draft.current_version_id;
  if p_selected_hook_index is not null and p_selected_hook_index >= cardinality(coalesce(p_alternative_hooks, '{}')) then
    raise exception 'no such hook' using errcode = '22023';
  end if;

  v_version := private.insert_draft_version(
    v_draft, p_body, p_alternative_hooks, p_selected_hook_index, 'admin', auth.uid(), null, v_current.rationale,
    v_current.voice_profile_version_id, v_current.fingerprint, p_change_note, p_claims, p_flags, null,
    v_current.id);
  perform private.log_event(v_company, 'draft.version_saved', 'draft', p_draft_id,
    jsonb_build_object('version_id', v_version));
  return (select version_no from public.draft_versions where id = v_version);
end;
$$;

-- Resolves or overrides one flag of a draft's current version. Overrides and
-- resolutions of blocking flags need a reason. A placeholder can't be
-- resolved: the text has to change.
create function public.resolve_review_flag(p_flag_id uuid, p_action text, p_note text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_company uuid := private.require_admin();
  v_flag public.review_flags;
  v_note text := btrim(coalesce(p_note, ''));
begin
  select f.* into v_flag from public.review_flags f
  join public.drafts d on d.current_version_id = f.draft_version_id
  where f.id = p_flag_id and f.company_id = v_company for update of f;
  if not found then
    raise exception 'flag not found on a current version' using errcode = 'P0002';
  end if;
  if v_flag.status <> 'open' then
    raise exception 'flag already handled' using errcode = '22023';
  end if;
  if p_action not in ('resolve', 'override') then
    raise exception 'unknown action' using errcode = '22023';
  end if;
  if v_flag.source = 'placeholder' then
    raise exception 'replace the placeholder in the text instead' using errcode = '22023';
  end if;
  -- A blocking flag is resolved (with a reason) or cleared by changing the text, never overridden.
  if p_action = 'override' and v_flag.severity = 'blocking' then
    raise exception 'a blocking flag cannot be overridden; resolve it with a reason or change the text'
      using errcode = '22023';
  end if;
  if (p_action = 'override' or v_flag.severity = 'blocking') and length(v_note) < 5 then
    raise exception 'give a reason (at least 5 characters)' using errcode = '22023';
  end if;
  update public.review_flags
  set status = case when p_action = 'override' then 'overridden' else 'resolved' end::public.flag_status,
      resolved_by = auth.uid(), resolved_at = now(), resolution_note = nullif(v_note, '')
  where id = p_flag_id;
  perform private.log_event(v_company, 'flag.' || case when p_action = 'override' then 'overridden' else 'resolved' end,
    'review_flag', p_flag_id, jsonb_build_object('kind', v_flag.kind, 'severity', v_flag.severity));
end;
$$;

-- The draft state machine (PRODUCT_SPEC §7.1). Phase 4b enables drafting,
-- admin review, rejection and archiving; later phases enable the rest.
create function public.transition_draft(p_draft_id uuid, p_to public.draft_status, p_reason text) returns void
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
    or (v_from = 'archived' and p_to = 'admin_review')
  ) then
    raise exception 'a % draft cannot become %', v_from, p_to using errcode = '22023';
  end if;
  update public.drafts set status = p_to where id = p_draft_id;
  perform private.log_event(v_company, 'draft.' || p_to::text, 'draft', p_draft_id,
    jsonb_build_object('from', v_from, 'reason', left(coalesce(p_reason, ''), 200)));
end;
$$;

revoke all on function private.normalize_body(text), private.set_version_derived(),
  private.insert_draft_version(public.drafts, text, text[], smallint, public.draft_author_kind, uuid, uuid, text, uuid, jsonb, text, jsonb, jsonb, jsonb, uuid)
from public, anon, authenticated;
grant execute on function private.normalize_body(text) to authenticated, service_role;

revoke all on function
  public.save_draft_version(uuid, text, text[], smallint, text, jsonb, jsonb),
  public.resolve_review_flag(uuid, text, text),
  public.transition_draft(uuid, public.draft_status, text),
  public.repetition_candidates(uuid, text, text, date, uuid, uuid)
from public, anon;
grant execute on function
  public.save_draft_version(uuid, text, text[], smallint, text, jsonb, jsonb),
  public.resolve_review_flag(uuid, text, text),
  public.transition_draft(uuid, public.draft_status, text)
to authenticated;
grant execute on function public.repetition_candidates(uuid, text, text, date, uuid, uuid) to authenticated, service_role;

revoke all on function public.complete_draft_run(uuid, text, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.complete_draft_run(uuid, text, jsonb, jsonb) to service_role;
