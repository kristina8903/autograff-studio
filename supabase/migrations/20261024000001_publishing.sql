-- Phase 9: assisted publishing and reporting. See docs/PRODUCT_SPEC.md §8,
-- DATA_MODEL.md §10, SECURITY.md §11, decisions D-05, D-11, D-32 and D-34.
--
-- * The publish gate (PRODUCT_SPEC §8.1) is one function, used by scheduling,
--   copying the text and recording a publication: the draft is approved or
--   scheduled, its live approval matches the current version's hash and
--   opening line, and no blocking flag is open. Nothing else sets
--   `scheduled` or `published`.
-- * Rescheduling keeps the approval; any material edit still withdraws it
--   and unschedules (Phase 7 trigger).
-- * One publication per draft. External publications (posted outside the
--   studio) have no draft and never count as approved studio posts.

-- ---------------------------------------------------------------------------
-- Text to publish
-- ---------------------------------------------------------------------------

-- The version's text as it will be posted: the body, with the chosen opening
-- line (if any) in place of the body's first line. A one-line body gets the
-- opening line above it. The TypeScript twin is publishableText() in
-- lib/domain/drafts.ts.
create function private.publishable_text(p_version public.draft_versions) returns text
language sql immutable set search_path = '' as $$
  select case
    when p_version.selected_hook_index is null then p_version.body
    when position(E'\n' in p_version.body) > 0 then
      p_version.alternative_hooks[p_version.selected_hook_index + 1]
        || substr(p_version.body, position(E'\n' in p_version.body))
    else p_version.alternative_hooks[p_version.selected_hook_index + 1] || E'\n\n' || p_version.body
  end;
$$;

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

alter table public.settings
  add column publications_become_examples boolean not null default true;

-- The slot's draft (the foreign key deferred since Phase 2).
alter table public.calendar_slots
  add constraint calendar_slots_draft_fk foreign key (draft_id) references public.drafts (id) on delete set null;

-- One draft per slot (and one slot per draft).
create unique index calendar_slots_draft_idx on public.calendar_slots (draft_id) where draft_id is not null;

-- A committed date only on a scheduled or published draft.
alter table public.drafts
  add constraint drafts_scheduled_only_when_scheduled check (scheduled_for is null or status in ('scheduled', 'published'));

create table public.publications (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id),
  founder_id uuid not null references public.founders (id),
  -- Null only for an external publication (posted outside the studio).
  draft_id uuid unique references public.drafts (id),
  is_external boolean not null default false,
  approved_version_id uuid references public.draft_versions (id),
  approval_id uuid references public.approvals (id),
  method text not null default 'manual' check (method in ('manual', 'linkedin_api')),
  published_at timestamptz not null,
  linkedin_url text not null check (linkedin_url ~ '^https://([a-z0-9-]+\.)?linkedin\.com/[^\s]+$' and length(linkedin_url) <= 2000),
  external_post_id text unique,
  published_text text not null check (length(trim(published_text)) between 1 and 6000),
  published_text_hash bytea not null,
  -- The text the founder approved, as it was to be posted, and whether the
  -- posted text differs from it (after normalization).
  approved_text text,
  differs_from_approved boolean not null default false,
  recorded_by uuid references public.profiles (user_id) on delete set null,
  created_at timestamptz not null default now(),
  unique (company_id, linkedin_url),
  check (is_external = (draft_id is null)),
  check (is_external or (approved_version_id is not null and approval_id is not null and approved_text is not null)),
  check (not is_external or (approved_text is null and not differs_from_approved))
);
create index publications_founder_idx on public.publications (founder_id, published_at);
create trigger publications_immutable before update or delete on public.publications
  for each row execute function private.reject_change();

create table public.performance_snapshots (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id),
  publication_id uuid not null references public.publications (id),
  captured_at timestamptz not null,
  source text not null default 'manual' check (source in ('manual', 'linkedin_api')),
  -- Each optional: impressions, reactions, comments, reshares, clicks, followers_gained.
  metrics jsonb not null check (jsonb_typeof(metrics) = 'object'),
  recorded_by uuid references public.profiles (user_id) on delete set null,
  created_at timestamptz not null default now()
);
create index performance_snapshots_publication_idx on public.performance_snapshots (publication_id, captured_at desc);
create trigger performance_snapshots_immutable before update or delete on public.performance_snapshots
  for each row execute function private.reject_change();

alter table public.publications enable row level security;
alter table public.performance_snapshots enable row level security;
revoke insert, update, delete, truncate on public.publications, public.performance_snapshots from authenticated;
create policy publications_admin_select on public.publications for select to authenticated
  using (private.is_admin() and company_id = private.current_company_id());
create policy performance_snapshots_admin_select on public.performance_snapshots for select to authenticated
  using (private.is_admin() and company_id = private.current_company_id());

-- ---------------------------------------------------------------------------
-- The publish gate (PRODUCT_SPEC §8.1)
-- ---------------------------------------------------------------------------

-- Returns the valid approval, or raises. The caller holds the draft's row lock.
create function private.publish_gate(p_draft public.drafts) returns public.approvals
language plpgsql stable security definer set search_path = '' as $$
declare
  v_approval public.approvals;
begin
  if p_draft.status not in ('approved', 'scheduled') then
    raise exception 'only an approved draft can be scheduled or published (this one is %)', p_draft.status
      using errcode = '22023';
  end if;
  select * into v_approval from private.valid_approval(p_draft.id);
  if v_approval.id is null then
    raise exception 'the draft has no valid approval of its current version' using errcode = '22023';
  end if;
  if exists (select 1 from public.review_flags where draft_version_id = p_draft.current_version_id
             and severity = 'blocking' and status = 'open') then
    raise exception 'a blocking flag is open' using errcode = '22023';
  end if;
  return v_approval;
end;
$$;

-- The draft, locked, for an admin of its company.
create function private.admin_draft(p_draft_id uuid) returns public.drafts
language plpgsql security definer set search_path = '' as $$
declare
  v_company uuid := private.require_admin();
  v_draft public.drafts;
begin
  select * into v_draft from public.drafts where id = p_draft_id and company_id = v_company for update;
  if not found then
    raise exception 'draft not found' using errcode = 'P0002';
  end if;
  return v_draft;
end;
$$;

-- Frees the slot a draft holds, if any.
create function private.free_slot(p_draft_id uuid) returns void
language sql security definer set search_path = '' as $$
  update public.calendar_slots set status = 'open', draft_id = null where draft_id = p_draft_id and status = 'filled';
$$;

-- ---------------------------------------------------------------------------
-- Scheduling
-- ---------------------------------------------------------------------------

-- Schedules (or reschedules) an approved draft for a date and time, optionally
-- in one of its founder's slots on that day. The approval is untouched.
create function public.schedule_draft(p_draft_id uuid, p_scheduled_for timestamptz, p_slot_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_draft public.drafts := private.admin_draft(p_draft_id);
  v_slot public.calendar_slots;
  v_timezone text;
begin
  perform private.publish_gate(v_draft);
  if p_scheduled_for is null then
    raise exception 'choose a date and time' using errcode = '22023';
  end if;
  select timezone into v_timezone from public.founders where id = v_draft.founder_id;
  if p_slot_id is not null then
    select * into v_slot from public.calendar_slots
    where id = p_slot_id and company_id = v_draft.company_id and founder_id = v_draft.founder_id for update;
    if not found then
      raise exception 'slot not found' using errcode = 'P0002';
    end if;
    if v_slot.status = 'skipped' or (v_slot.status = 'filled' and v_slot.draft_id <> v_draft.id) then
      raise exception 'that slot is not free' using errcode = '22023';
    end if;
    if (p_scheduled_for at time zone v_timezone)::date <> v_slot.slot_date then
      raise exception 'the time must be on the slot''s day (%)', v_slot.slot_date using errcode = '22023';
    end if;
  end if;
  update public.calendar_slots set status = 'open', draft_id = null
  where draft_id = v_draft.id and status = 'filled' and id is distinct from p_slot_id;
  if p_slot_id is not null then
    update public.calendar_slots set status = 'filled', draft_id = v_draft.id where id = p_slot_id;
  end if;
  update public.drafts set status = 'scheduled', scheduled_for = p_scheduled_for where id = v_draft.id;
  perform private.log_event(v_draft.company_id,
    case when v_draft.status = 'scheduled' then 'draft.rescheduled' else 'draft.scheduled' end, 'draft', v_draft.id,
    jsonb_build_object('scheduled_for', p_scheduled_for, 'slot_id', p_slot_id, 'previous', v_draft.scheduled_for));
end;
$$;

create function public.unschedule_draft(p_draft_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_draft public.drafts := private.admin_draft(p_draft_id);
  v_timezone text;
begin
  if v_draft.status <> 'scheduled' then
    raise exception 'the draft is not scheduled' using errcode = '22023';
  end if;
  select timezone into v_timezone from public.founders where id = v_draft.founder_id;
  perform private.free_slot(v_draft.id);
  update public.drafts
  set status = 'approved', proposed_date = (v_draft.scheduled_for at time zone v_timezone)::date, scheduled_for = null
  where id = v_draft.id;
  perform private.log_event(v_draft.company_id, 'draft.unscheduled', 'draft', v_draft.id,
    jsonb_build_object('was', v_draft.scheduled_for));
end;
$$;

-- ---------------------------------------------------------------------------
-- Copying and recording
-- ---------------------------------------------------------------------------

-- The exact approved text, from the server, for copy-to-clipboard. Only
-- while the gate holds.
create function public.approved_text(p_draft_id uuid) returns text
language plpgsql security definer set search_path = '' as $$
declare
  v_draft public.drafts := private.admin_draft(p_draft_id);
  v_version public.draft_versions;
begin
  perform private.publish_gate(v_draft);
  select * into v_version from public.draft_versions where id = v_draft.current_version_id;
  perform private.log_event(v_draft.company_id, 'draft.text_copied', 'draft', v_draft.id,
    jsonb_build_object('version_id', v_version.id));
  return private.publishable_text(v_version);
end;
$$;

-- Records what was actually posted. The gate applies; the posted text may
-- differ (LinkedIn reformats, or a last-minute tweak): that is stored,
-- flagged, audited, and proposed to the admin as a one-off edit.
create function public.record_publication(p_draft_id uuid, p_published_at timestamptz, p_linkedin_url text,
  p_published_text text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_draft public.drafts := private.admin_draft(p_draft_id);
  v_approval public.approvals := private.publish_gate(v_draft);
  v_version public.draft_versions;
  v_approved text;
  v_text text;
  v_differs boolean;
  v_id uuid;
  v_format public.post_format;
begin
  if exists (select 1 from public.publications where draft_id = v_draft.id) then
    raise exception 'this draft''s publication is already recorded' using errcode = '23505';
  end if;
  if p_published_at is null or p_published_at > now() + interval '1 hour' then
    raise exception 'give the time it was published (not in the future)' using errcode = '22023';
  end if;
  select * into v_version from public.draft_versions where id = v_draft.current_version_id;
  v_approved := private.publishable_text(v_version);
  v_text := coalesce(nullif(btrim(coalesce(p_published_text, '')), ''), v_approved);
  v_differs := private.normalize_body(v_text) <> private.normalize_body(v_approved);
  insert into public.publications (company_id, founder_id, draft_id, approved_version_id, approval_id, published_at,
    linkedin_url, published_text, published_text_hash, approved_text, differs_from_approved, recorded_by)
  values (v_draft.company_id, v_draft.founder_id, v_draft.id, v_version.id, v_approval.id, p_published_at,
    btrim(p_linkedin_url), v_text, sha256(convert_to(private.normalize_body(v_text), 'UTF8')), v_approved, v_differs,
    auth.uid())
  returning id into v_id;
  update public.drafts set status = 'published', scheduled_for = coalesce(scheduled_for, p_published_at)
  where id = v_draft.id;
  perform private.log_event(v_draft.company_id, 'publication.recorded', 'draft', v_draft.id,
    jsonb_build_object('publication_id', v_id, 'differs_from_approved', v_differs));
  if v_differs then
    perform private.log_event(v_draft.company_id, 'publication.text_differs', 'publication', v_id,
      jsonb_build_object('draft_id', v_draft.id));
    insert into public.feedback_signals (company_id, founder_id, draft_version_id, kind, statement, proposed_by)
    values (v_draft.company_id, v_draft.founder_id, v_version.id, 'one_off',
      'The posted text was changed from the approved version at publication; see the publication record.', 'system');
  end if;
  if (select publications_become_examples from public.settings where company_id = v_draft.company_id) then
    select format into v_format from public.concepts where id = v_draft.concept_id;
    insert into public.writing_examples (company_id, founder_id, kind, body, source_url, published_at, format, added_by)
    values (v_draft.company_id, v_draft.founder_id, 'published_linkedin', v_text, btrim(p_linkedin_url),
      (p_published_at at time zone (select timezone from public.founders where id = v_draft.founder_id))::date,
      v_format, auth.uid())
    on conflict (founder_id, body_hash) do nothing;
  end if;
  return v_id;
end;
$$;

-- A post published outside the studio: recorded for repetition checks and
-- reports, never as an approved studio post. It becomes a writing example
-- (not approved for voice), which is what the repetition check reads.
create function public.record_external_publication(p_founder_id uuid, p_published_at timestamptz, p_linkedin_url text,
  p_published_text text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_company uuid := private.require_admin();
  v_id uuid;
begin
  perform private.require_founder_in_company(p_founder_id, v_company);
  if p_published_at is null or p_published_at > now() + interval '1 hour' then
    raise exception 'give the time it was published (not in the future)' using errcode = '22023';
  end if;
  if length(btrim(coalesce(p_published_text, ''))) = 0 then
    raise exception 'paste the text that was posted' using errcode = '22023';
  end if;
  insert into public.publications (company_id, founder_id, is_external, published_at, linkedin_url, published_text,
    published_text_hash, recorded_by)
  values (v_company, p_founder_id, true, p_published_at, btrim(p_linkedin_url), btrim(p_published_text),
    sha256(convert_to(private.normalize_body(btrim(p_published_text)), 'UTF8')), auth.uid())
  returning id into v_id;
  insert into public.writing_examples (company_id, founder_id, kind, body, source_url, published_at, added_by)
  values (v_company, p_founder_id, 'published_linkedin', btrim(p_published_text), btrim(p_linkedin_url),
    (p_published_at at time zone (select timezone from public.founders where id = p_founder_id))::date, auth.uid())
  on conflict (founder_id, body_hash) do nothing;
  perform private.log_event(v_company, 'publication.recorded_external', 'publication', v_id,
    jsonb_build_object('founder_id', p_founder_id));
  return v_id;
end;
$$;

-- Manually entered metrics: an append-only series per publication.
create function public.add_performance_snapshot(p_publication_id uuid, p_captured_at timestamptz, p_metrics jsonb)
returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_company uuid := private.require_admin();
  v_publication public.publications;
  v_id uuid;
begin
  select * into v_publication from public.publications where id = p_publication_id and company_id = v_company;
  if not found then
    raise exception 'publication not found' using errcode = 'P0002';
  end if;
  if jsonb_typeof(p_metrics) <> 'object' or p_metrics = '{}'::jsonb
     or exists (select 1 from jsonb_each(p_metrics) m
                where m.key not in ('impressions', 'reactions', 'comments', 'reshares', 'clicks', 'followers_gained')
                   or jsonb_typeof(m.value) <> 'number' or (m.value)::numeric < 0
                   or (m.value)::numeric <> trunc((m.value)::numeric)) then
    raise exception 'metrics are whole, non-negative numbers: impressions, reactions, comments, reshares, clicks, followers_gained'
      using errcode = '22023';
  end if;
  if p_captured_at is null or p_captured_at < v_publication.published_at or p_captured_at > now() + interval '1 hour' then
    raise exception 'the capture time must be after publication and not in the future' using errcode = '22023';
  end if;
  insert into public.performance_snapshots (company_id, publication_id, captured_at, metrics, recorded_by)
  values (v_company, p_publication_id, p_captured_at, p_metrics, auth.uid())
  returning id into v_id;
  perform private.log_event(v_company, 'publication.metrics_added', 'publication', p_publication_id);
  return v_id;
end;
$$;

create function public.set_publications_become_examples(p_on boolean) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_company uuid := private.require_admin();
begin
  update public.settings set publications_become_examples = coalesce(p_on, true), updated_by = auth.uid()
  where company_id = v_company;
  perform private.log_event(v_company, 'settings.publications_become_examples', 'settings', null,
    jsonb_build_object('on', coalesce(p_on, true)));
end;
$$;

-- The founder's own scheduled and published dates.
create function public.founder_publishing()
returns table (draft_id uuid, scheduled_for timestamptz, published_at timestamptz, linkedin_url text)
language sql stable security definer set search_path = '' as $$
  select d.id, d.scheduled_for, p.published_at, p.linkedin_url
  from public.drafts d left join public.publications p on p.draft_id = d.id
  where d.founder_id = private.current_founder_id() and d.status in ('scheduled', 'published')
    and d.shared_with_founder_at is not null;
$$;

-- ---------------------------------------------------------------------------
-- State changes, extended to scheduled drafts
-- ---------------------------------------------------------------------------

-- Taking back an approved or scheduled draft withdraws the approval and
-- unschedules it.
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
    or (v_from in ('approved', 'scheduled') and p_to in ('admin_review', 'rejected', 'archived'))
    or (v_from = 'archived' and p_to = 'admin_review')
  ) then
    raise exception 'a % draft cannot become %', v_from, p_to using errcode = '22023';
  end if;
  if v_from in ('approved', 'scheduled') then
    update public.approvals set invalidated_at = now(), invalidated_reason = 'withdrawn by the admin'
    where draft_id = p_draft_id and decision = 'approved' and invalidated_at is null;
    perform private.free_slot(p_draft_id);
  end if;
  update public.drafts set status = p_to, scheduled_for = null where id = p_draft_id;
  perform private.log_event(v_company, 'draft.' || p_to::text, 'draft', p_draft_id,
    jsonb_build_object('from', v_from, 'reason', left(coalesce(p_reason, ''), 200)));
end;
$$;

-- The founder can withdraw their approval of a scheduled draft too.
create or replace function public.revoke_approval(p_draft_id uuid, p_reason text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_draft public.drafts := private.founder_draft(p_draft_id);
begin
  if v_draft.status not in ('approved', 'scheduled') then
    raise exception 'the draft is not approved' using errcode = '22023';
  end if;
  update public.approvals
  set invalidated_at = now(), invalidated_reason = left('revoked by the founder: ' || coalesce(p_reason, ''), 300)
  where draft_id = v_draft.id and decision = 'approved' and invalidated_at is null;
  perform private.free_slot(v_draft.id);
  update public.drafts set status = 'founder_review', scheduled_for = null where id = v_draft.id;
  perform private.log_event(v_draft.company_id, 'approval.revoked', 'draft', v_draft.id);
end;
$$;

-- Edits and rewrites of a scheduled draft are allowed: a material change
-- withdraws the approval and unschedules it (the Phase 7 trigger).
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
       or (v_run.kind = 'rewrite' and v_draft.status not in ('founder_review', 'changes_requested', 'approved', 'scheduled')) then
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
  if v_draft.status not in ('drafting', 'admin_review', 'founder_review', 'changes_requested', 'approved', 'scheduled') then
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

create or replace function public.founder_save_version(p_draft_id uuid, p_body text, p_change_note text) returns integer
language plpgsql security definer set search_path = '' as $$
declare
  v_draft public.drafts := private.founder_draft(p_draft_id);
  v_current public.draft_versions;
  v_version uuid;
  v_flags jsonb;
  v_claims jsonb;
begin
  if v_draft.status not in ('founder_review', 'changes_requested', 'approved', 'scheduled') then
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
    'approved_fact', c.approved_fact, 'finding_id', c.finding_id, 'support_status', c.support_status)), '[]'::jsonb)
  into v_claims
  from public.draft_claims c
  where c.draft_version_id = v_current.id and position(lower(c.claim_text) in lower(p_body)) > 0;

  v_version := private.insert_draft_version(
    v_draft, p_body, v_current.alternative_hooks, v_current.selected_hook_index, 'founder', auth.uid(), null,
    v_current.rationale, v_current.voice_profile_version_id, v_current.fingerprint, p_change_note, v_claims, v_flags,
    null, null);

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

  update public.drafts set status = 'founder_review' where id = v_draft.id and status = 'changes_requested';
  perform private.log_event(v_draft.company_id, 'draft.founder_edited', 'draft', v_draft.id,
    jsonb_build_object('version_id', v_version));
  return (select version_no from public.draft_versions where id = v_version);
end;
$$;

create or replace function public.request_rewrite(p_draft_id uuid, p_instructions text, p_idempotency_key text)
returns table (request_id uuid, run_id uuid, run_status public.generation_status, message text)
language plpgsql security definer set search_path = '' as $$
declare
  v_draft public.drafts := private.founder_draft(p_draft_id);
  v_origin public.generation_runs;
  v_ceiling numeric;
  v_run public.generation_runs;
  v_request uuid;
begin
  if v_draft.status not in ('founder_review', 'changes_requested', 'approved', 'scheduled') then
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

revoke all on function private.publishable_text(public.draft_versions), private.publish_gate(public.drafts),
  private.admin_draft(uuid), private.free_slot(uuid)
from public, anon, authenticated;

revoke all on function
  public.schedule_draft(uuid, timestamptz, uuid), public.unschedule_draft(uuid), public.approved_text(uuid),
  public.record_publication(uuid, timestamptz, text, text),
  public.record_external_publication(uuid, timestamptz, text, text),
  public.add_performance_snapshot(uuid, timestamptz, jsonb), public.set_publications_become_examples(boolean),
  public.founder_publishing()
from public, anon;
grant execute on function
  public.schedule_draft(uuid, timestamptz, uuid), public.unschedule_draft(uuid), public.approved_text(uuid),
  public.record_publication(uuid, timestamptz, text, text),
  public.record_external_publication(uuid, timestamptz, text, text),
  public.add_performance_snapshot(uuid, timestamptz, jsonb), public.set_publications_become_examples(boolean),
  public.founder_publishing()
to authenticated;
