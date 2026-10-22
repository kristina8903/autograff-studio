-- Phase 5: industry research. See docs/INTEGRATIONS.md §3, DATA_MODEL.md §6,
-- SECURITY.md §6, decisions D-06 and D-33.
--
-- * Sources and findings come from the web: untrusted. The runner stores only
--   what passed the checks in lib/domain/research.ts (quotes and numbers found
--   in the excerpt, URLs only from the provider).
-- * Only a person accepts a source or verifies a finding. Generation uses
--   only human-verified findings of accepted sources.
-- * Everything here is admin-only. Founders see the sources behind the claims
--   of their own shared drafts, through founder_draft_sources.

create type public.date_precision as enum ('day', 'month', 'year', 'unknown');
create type public.source_tier as enum ('primary', 'reputable_publication', 'secondary', 'discussion', 'unknown');
create type public.source_status as enum ('candidate', 'accepted', 'rejected');
create type public.finding_status as enum ('unverified', 'machine_supported', 'human_verified', 'disputed', 'rejected');

-- Domain allow and block lists (bare hostnames; subdomains included).
alter table public.settings
  add column research_allowed_domains text[] not null default '{}' check (cardinality(research_allowed_domains) <= 64),
  add column research_blocked_domains text[] not null default '{}' check (cardinality(research_blocked_domains) <= 64);

-- Searches billed by the provider, counted per run (their cost is in actual_cost_usd).
alter table public.generation_runs add column web_searches integer not null default 0 check (web_searches >= 0);

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

create table public.research_queries (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id),
  target_month date not null check (extract(day from target_month) = 1),
  concept_id uuid references public.concepts (id) on delete set null,
  query_text text not null check (length(trim(query_text)) between 3 and 300),
  provider text not null,
  generation_run_id uuid not null unique references public.generation_runs (id),
  sources_found integer not null default 0,
  sources_already_stored integer not null default 0,
  findings_rejected integer not null default 0,
  created_by uuid references public.profiles (user_id) on delete set null,
  created_at timestamptz not null default now()
);
create index research_queries_month_idx on public.research_queries (company_id, target_month);

create table public.research_sources (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id),
  url text not null check (url ~ '^https?://' and length(url) <= 2000),
  canonical_url text not null check (canonical_url ~ '^https://' and length(canonical_url) <= 2000),
  title text not null default '' check (length(title) <= 500),
  publisher text not null default '' check (length(publisher) <= 200),
  -- The provider's date for the page, as given, and what we could read from it.
  page_age_raw text check (length(page_age_raw) <= 100),
  published_at date,
  published_at_precision public.date_precision not null default 'unknown',
  retrieved_at timestamptz not null default now(),
  source_tier public.source_tier not null default 'unknown',
  -- Short verbatim passages only, never the full page.
  excerpt text not null check (length(excerpt) between 1 and 4000),
  content_hash bytea not null,
  provider text not null,
  research_query_id uuid not null references public.research_queries (id),
  status public.source_status not null default 'candidate',
  review_note text not null default '' check (length(review_note) <= 500),
  reviewed_by uuid references public.profiles (user_id) on delete set null,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, canonical_url),
  check ((published_at is null) = (published_at_precision = 'unknown'))
);
create trigger research_sources_touch before update on public.research_sources
  for each row execute function private.touch_updated_at();

create table public.research_findings (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id),
  source_id uuid not null references public.research_sources (id) on delete cascade,
  research_query_id uuid not null references public.research_queries (id),
  claim_text text not null check (length(trim(claim_text)) between 5 and 1000),
  quote text check (length(quote) <= 1000),
  -- {value, unit, population, period}
  data jsonb check (data is null or jsonb_typeof(data) = 'object'),
  event_date date,
  event_date_precision public.date_precision not null default 'unknown',
  verification_status public.finding_status not null,
  verified_by uuid references public.profiles (user_id) on delete set null,
  verified_at timestamptz,
  notes text not null default '' check (length(notes) <= 500),
  conflicts_with uuid[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((event_date is null) = (event_date_precision = 'unknown')),
  -- Machine checks never verify: only a person does.
  check (verification_status <> 'human_verified' or verified_by is not null)
);
create index research_findings_source_idx on public.research_findings (source_id);
create trigger research_findings_touch before update on public.research_findings
  for each row execute function private.touch_updated_at();

alter table public.draft_claims
  add constraint draft_claims_finding_fk foreign key (finding_id) references public.research_findings (id) on delete set null;

alter table public.research_queries enable row level security;
alter table public.research_sources enable row level security;
alter table public.research_findings enable row level security;
revoke insert, update, delete, truncate on public.research_queries, public.research_sources, public.research_findings
  from authenticated;
create policy research_queries_admin_select on public.research_queries for select to authenticated
  using (private.is_admin() and company_id = private.current_company_id());
create policy research_sources_admin_select on public.research_sources for select to authenticated
  using (private.is_admin() and company_id = private.current_company_id());
create policy research_findings_admin_select on public.research_findings for select to authenticated
  using (private.is_admin() and company_id = private.current_company_id());

-- ---------------------------------------------------------------------------
-- Runner (service_role)
-- ---------------------------------------------------------------------------

-- Stores a research run: the query, new sources and their checked findings.
-- A page already stored (same canonical URL) is kept as it was, with its
-- findings: its excerpt is what those findings were checked against.
create function public.complete_research_run(p_run_id uuid, p_served_model text, p_usage jsonb, p_payload jsonb)
returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_run public.generation_runs;
  v_query uuid;
  v_source uuid;
  v_source_json jsonb;
  v_found integer := 0;
  v_existing integer := 0;
begin
  select * into v_run from public.generation_runs where id = p_run_id and status = 'running' and kind = 'research' for update;
  if not found then
    raise exception 'run is not a running research run' using errcode = '22023';
  end if;
  insert into public.research_queries (company_id, target_month, concept_id, query_text, provider, generation_run_id,
    findings_rejected, created_by)
  values (v_run.company_id, v_run.target_month,
    (select id from public.concepts where id = nullif(v_run.params ->> 'concept_id', '')::uuid and company_id = v_run.company_id),
    v_run.params ->> 'query', v_run.provider, v_run.id, coalesce((p_payload ->> 'findings_rejected')::integer, 0),
    v_run.requested_by)
  returning id into v_query;

  for v_source_json in select * from jsonb_array_elements(coalesce(p_payload -> 'sources', '[]'::jsonb)) loop
    insert into public.research_sources (company_id, url, canonical_url, title, publisher, page_age_raw, published_at,
      published_at_precision, excerpt, content_hash, provider, research_query_id)
    values (v_run.company_id, v_source_json ->> 'url', v_source_json ->> 'canonical_url',
      left(coalesce(v_source_json ->> 'title', ''), 500), left(coalesce(v_source_json ->> 'publisher', ''), 200),
      left(v_source_json ->> 'page_age', 100), (v_source_json ->> 'published_at')::date,
      coalesce(v_source_json ->> 'published_at_precision', 'unknown')::public.date_precision,
      v_source_json ->> 'excerpt', sha256(convert_to(v_source_json ->> 'excerpt', 'UTF8')), v_run.provider, v_query)
    on conflict (company_id, canonical_url) do nothing
    returning id into v_source;
    if v_source is null then
      v_existing := v_existing + 1;
      continue;
    end if;
    v_found := v_found + 1;
    insert into public.research_findings (company_id, source_id, research_query_id, claim_text, quote, data, event_date,
      event_date_precision, verification_status)
    select v_run.company_id, v_source, v_query, f ->> 'claim_text', f ->> 'quote', nullif(f -> 'data', 'null'::jsonb),
      (f ->> 'event_date')::date, coalesce(f ->> 'event_date_precision', 'unknown')::public.date_precision,
      (f ->> 'verification_status')::public.finding_status
    from jsonb_array_elements(coalesce(v_source_json -> 'findings', '[]'::jsonb)) f
    where f ->> 'verification_status' in ('unverified', 'machine_supported');
    v_source := null;
  end loop;

  update public.research_queries set sources_found = v_found, sources_already_stored = v_existing where id = v_query;
  update public.generation_runs
  set status = 'succeeded', finished_at = now(), served_model = p_served_model,
      web_searches = web_searches + coalesce((p_usage ->> 'web_searches')::integer, 0),
      input_tokens = input_tokens + coalesce((p_usage ->> 'input_tokens')::integer, 0),
      output_tokens = output_tokens + coalesce((p_usage ->> 'output_tokens')::integer, 0),
      cache_read_tokens = cache_read_tokens + coalesce((p_usage ->> 'cache_read_tokens')::integer, 0),
      cache_write_tokens = cache_write_tokens + coalesce((p_usage ->> 'cache_write_tokens')::integer, 0),
      actual_cost_usd = coalesce(actual_cost_usd, 0) + coalesce((p_usage ->> 'cost_usd')::numeric, 0)
  where id = p_run_id;
  perform private.log_event(v_run.company_id, 'research.completed', 'research_query', v_query,
    jsonb_build_object('run_id', v_run.id, 'sources', v_found, 'already_stored', v_existing), 'system');
  return v_query;
end;
$$;

-- ---------------------------------------------------------------------------
-- Admin review
-- ---------------------------------------------------------------------------

create function public.review_research_source(p_source_id uuid, p_status public.source_status, p_tier public.source_tier,
  p_note text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_company uuid := private.require_admin();
begin
  update public.research_sources
  set status = p_status, source_tier = p_tier, review_note = left(btrim(coalesce(p_note, '')), 500),
      reviewed_by = auth.uid(), reviewed_at = now()
  where id = p_source_id and company_id = v_company;
  if not found then
    raise exception 'source not found' using errcode = 'P0002';
  end if;
  perform private.log_event(v_company, 'research.source_' || p_status::text, 'research_source', p_source_id,
    jsonb_build_object('tier', p_tier));
end;
$$;

-- A person verifies, disputes or rejects a finding. Verifying needs an
-- accepted source; disputing needs a reason.
create function public.review_research_finding(p_finding_id uuid, p_status public.finding_status, p_note text)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_company uuid := private.require_admin();
  v_finding public.research_findings;
  v_source_status public.source_status;
begin
  select * into v_finding from public.research_findings where id = p_finding_id and company_id = v_company for update;
  if not found then
    raise exception 'finding not found' using errcode = 'P0002';
  end if;
  if p_status not in ('human_verified', 'disputed', 'rejected', 'unverified') then
    raise exception 'a person can verify, dispute, reject or reopen a finding' using errcode = '22023';
  end if;
  select status into v_source_status from public.research_sources where id = v_finding.source_id;
  if p_status = 'human_verified' and v_source_status <> 'accepted' then
    raise exception 'accept the source before verifying its findings' using errcode = '22023';
  end if;
  if p_status = 'disputed' and length(btrim(coalesce(p_note, ''))) < 5 then
    raise exception 'say why it is disputed (at least 5 characters)' using errcode = '22023';
  end if;
  update public.research_findings
  set verification_status = p_status, notes = left(btrim(coalesce(p_note, '')), 500),
      verified_by = case when p_status = 'unverified' then null else auth.uid() end,
      verified_at = case when p_status = 'unverified' then null else now() end
  where id = p_finding_id;
  perform private.log_event(v_company, 'research.finding_' || p_status::text, 'research_finding', p_finding_id);
end;
$$;

-- Marks two findings as disagreeing (or not), on both sides.
create function public.link_research_findings(p_a uuid, p_b uuid, p_conflict boolean) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_company uuid := private.require_admin();
begin
  if p_a = p_b or (select count(*) from public.research_findings where id in (p_a, p_b) and company_id = v_company) <> 2 then
    raise exception 'finding not found' using errcode = 'P0002';
  end if;
  update public.research_findings f
  set conflicts_with = case when p_conflict
      then array(select distinct x from unnest(f.conflicts_with || array[case when f.id = p_a then p_b else p_a end]) x)
      else array_remove(f.conflicts_with, case when f.id = p_a then p_b else p_a end) end
  where f.id in (p_a, p_b);
  perform private.log_event(v_company, case when p_conflict then 'research.conflict_linked' else 'research.conflict_unlinked' end,
    'research_finding', p_a, jsonb_build_object('other', p_b));
end;
$$;

create function public.set_research_domains(p_allowed text[], p_blocked text[]) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_company uuid := private.require_admin();
  v_pattern constant text := '^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$';
begin
  if exists (select 1 from unnest(coalesce(p_allowed, '{}') || coalesce(p_blocked, '{}')) d where d !~ v_pattern) then
    raise exception 'each entry must be a domain such as census.gov' using errcode = '22023';
  end if;
  update public.settings
  set research_allowed_domains = coalesce(p_allowed, '{}'), research_blocked_domains = coalesce(p_blocked, '{}'),
      updated_by = auth.uid()
  where company_id = v_company;
  perform private.log_event(v_company, 'settings.research_domains', 'settings', null,
    jsonb_build_object('allowed', cardinality(coalesce(p_allowed, '{}')), 'blocked', cardinality(coalesce(p_blocked, '{}'))));
end;
$$;

-- ---------------------------------------------------------------------------
-- Draft claims cite findings
-- ---------------------------------------------------------------------------

-- Replaced to store finding_id: kept only for a finding of the same company.
create or replace function private.insert_draft_version(
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
    approved_fact, finding_id, support_status)
  select v_id, p_draft.company_id, c ->> 'claim_text', (c ->> 'claim_kind')::public.claim_kind,
    (c ->> 'span_start')::integer, (c ->> 'span_end')::integer, c ->> 'approved_fact',
    (select f.id from public.research_findings f
     where f.id = nullif(c ->> 'finding_id', '')::uuid and f.company_id = p_draft.company_id),
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

-- Replaced so a founder's edit keeps each claim's finding.
create or replace function public.founder_save_version(p_draft_id uuid, p_body text, p_change_note text) returns integer
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

-- The founder sees what each factual claim of their current version rests on:
-- an approved fact from the brief, a research source, or nothing (flagged).
create function public.founder_draft_sources(p_draft_id uuid)
returns table (claim_text text, support_status public.claim_support, approved_fact text, source_title text,
  source_url text, publisher text, published_at date, published_at_precision public.date_precision,
  finding_quote text, finding_status public.finding_status)
language sql stable security definer set search_path = '' as $$
  select c.claim_text, c.support_status, c.approved_fact, s.title, s.url, s.publisher, s.published_at,
    coalesce(s.published_at_precision, 'unknown'), f.quote, f.verification_status
  from public.drafts d
  join public.draft_claims c on c.draft_version_id = d.current_version_id
  left join public.research_findings f on f.id = c.finding_id
  left join public.research_sources s on s.id = f.source_id
  where d.id = p_draft_id and d.founder_id = private.current_founder_id()
    and d.shared_with_founder_at is not null and private.founder_visible(d.status)
    and c.claim_kind = 'sourced_fact'
  order by c.span_start nulls last, c.claim_text;
$$;

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------

revoke all on function public.complete_research_run(uuid, text, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.complete_research_run(uuid, text, jsonb, jsonb) to service_role;

revoke all on function
  public.review_research_source(uuid, public.source_status, public.source_tier, text),
  public.review_research_finding(uuid, public.finding_status, text),
  public.link_research_findings(uuid, uuid, boolean),
  public.set_research_domains(text[], text[]),
  public.founder_draft_sources(uuid)
from public, anon;
grant execute on function
  public.review_research_source(uuid, public.source_status, public.source_tier, text),
  public.review_research_finding(uuid, public.finding_status, text),
  public.link_research_findings(uuid, uuid, boolean),
  public.set_research_domains(text[], text[]),
  public.founder_draft_sources(uuid)
to authenticated;
