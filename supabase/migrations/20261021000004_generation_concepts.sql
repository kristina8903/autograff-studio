-- Phase 4a: AI generation runs (job table, idempotency, cost ceilings) and
-- content concepts. See docs/DATA_MODEL.md §7, §9, docs/ARCHITECTURE.md §4.3,
-- §5 and docs/SECURITY.md §10.
--
-- Who does what:
--   * The admin requests a run (request_generation). The budget is checked
--     here, atomically, before any API call: over-budget requests are
--     recorded as 'refused' and never run.
--   * The job runner, using the secret key (service_role), claims runs and
--     records their results. Only service_role can call those functions.

create type public.generation_kind as enum (
  'concept_batch', 'concept_regen', 'draft', 'draft_regen', 'rewrite', 'research', 'finding_extraction',
  'insight_extraction', 'fingerprint', 'repetition_judge', 'feedback_classification'
);
create type public.generation_status as enum ('queued', 'running', 'succeeded', 'failed', 'refused', 'cancelled');
create type public.concept_status as enum ('proposed', 'selected', 'drafted', 'rejected', 'archived');

-- ---------------------------------------------------------------------------
-- Budget settings (D-21). Not writable by any signed-in user: production's
-- $50 is set once by the owner with SQL (docs/runbooks). Hard caps in CHECKs.
-- ---------------------------------------------------------------------------

alter table public.settings
  add column ai_monthly_budget_usd numeric(8, 2) not null default 10
    check (ai_monthly_budget_usd >= 0 and ai_monthly_budget_usd <= 50),
  add column ai_per_run_ceiling_usd numeric(8, 2) not null default 2
    check (ai_per_run_ceiling_usd >= 0 and ai_per_run_ceiling_usd <= 5);

-- The admin may still edit the email domains (Phase 1), and nothing else here.
revoke update on public.settings from authenticated;
grant update (allowed_email_domains, updated_by, updated_at) on public.settings to authenticated;

-- ---------------------------------------------------------------------------
-- Generation runs
-- ---------------------------------------------------------------------------

create table public.generation_runs (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id),
  kind public.generation_kind not null,
  founder_id uuid references public.founders (id) on delete set null,
  target_month date check (target_month is null or extract(day from target_month) = 1),
  requested_by uuid references public.profiles (user_id) on delete set null,
  provider text not null check (provider in ('anthropic', 'fake')),
  -- The model requested; the model that actually answered is served_model
  -- (they differ when a refusal was retried on a fallback model).
  model text not null,
  served_model text,
  prompt_template text not null,
  prompt_template_version integer not null check (prompt_template_version > 0),
  -- Ids of the brief version, voice version and examples used. Never the
  -- full prompt (D-10).
  input_refs jsonb not null default '{}'::jsonb check (jsonb_typeof(input_refs) = 'object'),
  params jsonb not null default '{}'::jsonb check (jsonb_typeof(params) = 'object'),
  status public.generation_status not null default 'queued',
  idempotency_key text not null check (length(idempotency_key) between 16 and 200),
  attempt smallint not null default 0 check (attempt between 0 and 3),
  run_after timestamptz not null default now(),
  error_code text,
  error_message text check (length(error_message) <= 500),
  input_tokens integer not null default 0,
  output_tokens integer not null default 0,
  cache_read_tokens integer not null default 0,
  cache_write_tokens integer not null default 0,
  estimated_cost_usd numeric(10, 6) not null check (estimated_cost_usd >= 0),
  actual_cost_usd numeric(10, 6) check (actual_cost_usd >= 0),
  created_at timestamptz not null default now(),
  started_at timestamptz,
  finished_at timestamptz,
  unique (company_id, idempotency_key)
);
create index generation_runs_company_created_idx on public.generation_runs (company_id, created_at desc);
create index generation_runs_queue_idx on public.generation_runs (run_after) where status = 'queued';

-- ---------------------------------------------------------------------------
-- Concepts
-- ---------------------------------------------------------------------------

create table public.concepts (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id),
  founder_id uuid not null references public.founders (id) on delete cascade,
  target_month date not null check (extract(day from target_month) = 1),
  brief_version_id uuid not null references public.brief_versions (id),
  voice_profile_version_id uuid references public.voice_profile_versions (id),
  -- Null when the admin typed the concept by hand.
  generation_run_id uuid references public.generation_runs (id),
  title text not null check (length(trim(title)) between 1 and 200),
  audience text not null default '' check (length(audience) <= 300),
  core_argument text not null check (length(trim(core_argument)) between 1 and 1000),
  hook text not null default '' check (length(hook) <= 500),
  format public.post_format not null,
  why_this_founder text not null default '' check (length(why_this_founder) <= 1000),
  evidence_requirements text[] not null default '{}' check (cardinality(evidence_requirements) <= 10),
  needs_personal_story boolean not null default false,
  -- topics, argument_key, hook_type, format, audience, product_mentions, cta (PRODUCT_SPEC §6).
  fingerprint jsonb not null default '{}'::jsonb check (jsonb_typeof(fingerprint) = 'object'),
  status public.concept_status not null default 'proposed',
  -- Set when this concept was regenerated: the replacement.
  superseded_by uuid references public.concepts (id),
  edited_by uuid references public.profiles (user_id) on delete set null,
  edited_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (superseded_by is null or status = 'archived')
);
create index concepts_founder_month_idx on public.concepts (founder_id, target_month, status);

create trigger concepts_touch before update on public.concepts
  for each row execute function private.touch_updated_at();

-- ---------------------------------------------------------------------------
-- Privileges and row-level security
-- ---------------------------------------------------------------------------

alter table public.generation_runs enable row level security;
alter table public.concepts enable row level security;

revoke insert, update, delete, truncate on public.generation_runs, public.concepts from authenticated;

-- Runs, costs and concepts are admin-internal (D-13): founders see none of it.
create policy generation_runs_admin_select on public.generation_runs for select to authenticated
  using (private.is_admin() and company_id = private.current_company_id());
create policy concepts_admin_select on public.concepts for select to authenticated
  using (private.is_admin() and company_id = private.current_company_id());

-- ---------------------------------------------------------------------------
-- Spend
-- ---------------------------------------------------------------------------

-- Month-to-date AI spend for a company: actual cost of finished runs plus the
-- estimate of runs still queued or running (so concurrent requests can't
-- overspend between them).
create function private.ai_spend_this_month(p_company uuid) returns numeric
language sql stable security definer set search_path = '' as $$
  select coalesce(sum(
    case when status in ('queued', 'running') then estimated_cost_usd else coalesce(actual_cost_usd, 0) end
  ), 0)
  from public.generation_runs
  where company_id = p_company and created_at >= date_trunc('month', now());
$$;

create function public.ai_spend_summary()
returns table (spent_usd numeric, monthly_budget_usd numeric, per_run_ceiling_usd numeric)
language plpgsql stable security definer set search_path = '' as $$
declare
  v_company uuid := private.require_admin();
begin
  return query
  select private.ai_spend_this_month(v_company), s.ai_monthly_budget_usd, s.ai_per_run_ceiling_usd
  from public.settings s where s.company_id = v_company;
end;
$$;

-- ---------------------------------------------------------------------------
-- Requesting a run (admin)
-- ---------------------------------------------------------------------------

-- Returns the run and its status. The same idempotency key returns the
-- existing run instead of creating a second one. A run over either ceiling is
-- recorded as 'refused' and never executed.
create function public.request_generation(
  p_kind public.generation_kind,
  p_founder_id uuid,
  p_target_month date,
  p_provider text,
  p_model text,
  p_prompt_template text,
  p_prompt_template_version integer,
  p_input_refs jsonb,
  p_params jsonb,
  p_estimated_cost_usd numeric,
  p_idempotency_key text
) returns table (run_id uuid, run_status public.generation_status, message text)
language plpgsql security definer set search_path = '' as $$
declare
  v_company uuid := private.require_admin();
  v_settings public.settings;
  v_spent numeric;
  v_status public.generation_status := 'queued';
  v_message text := null;
  v_id uuid;
  v_existing uuid;
  v_existing_status public.generation_status;
begin
  if p_founder_id is not null then
    perform private.require_founder_in_company(p_founder_id, v_company);
  end if;
  if p_estimated_cost_usd is null or p_estimated_cost_usd < 0 then
    raise exception 'an estimated cost is required' using errcode = '22023';
  end if;

  -- One request at a time per company, so two can't both pass the budget check.
  perform 1 from public.settings where company_id = v_company for update;
  select * into v_settings from public.settings where company_id = v_company;

  -- (A SELECT INTO that finds nothing sets its targets to null, so it gets its own.)
  select g.id, g.status into v_existing, v_existing_status from public.generation_runs g
  where g.company_id = v_company and g.idempotency_key = p_idempotency_key;
  if found then
    return query select v_existing, v_existing_status, 'already requested'::text;
    return;
  end if;

  v_spent := private.ai_spend_this_month(v_company);
  if p_estimated_cost_usd > v_settings.ai_per_run_ceiling_usd then
    v_status := 'refused';
    v_message := format('This run could cost up to $%s, over the $%s per-run ceiling.',
      round(p_estimated_cost_usd, 2), v_settings.ai_per_run_ceiling_usd);
  elsif v_spent + p_estimated_cost_usd > v_settings.ai_monthly_budget_usd then
    v_status := 'refused';
    v_message := format('This run could cost up to $%s, and $%s of the $%s monthly budget is already used.',
      round(p_estimated_cost_usd, 2), round(v_spent, 2), v_settings.ai_monthly_budget_usd);
  end if;

  insert into public.generation_runs (
    company_id, kind, founder_id, target_month, requested_by, provider, model, prompt_template,
    prompt_template_version, input_refs, params, status, idempotency_key, estimated_cost_usd,
    error_code, error_message, finished_at
  ) values (
    v_company, p_kind, p_founder_id, p_target_month, auth.uid(), p_provider, p_model, p_prompt_template,
    p_prompt_template_version, coalesce(p_input_refs, '{}'::jsonb), coalesce(p_params, '{}'::jsonb), v_status,
    p_idempotency_key, p_estimated_cost_usd,
    case when v_status = 'refused' then 'budget' end, v_message,
    case when v_status = 'refused' then now() end
  ) returning id into v_id;

  perform private.log_event(v_company, 'generation.' || v_status::text, 'generation_run', v_id,
    jsonb_build_object('kind', p_kind, 'founder_id', p_founder_id, 'estimated_cost_usd', p_estimated_cost_usd));
  return query select v_id, v_status, v_message;
end;
$$;

-- ---------------------------------------------------------------------------
-- Job runner (service_role only)
-- ---------------------------------------------------------------------------

-- Claims one due run (or the given one) and marks it running. Concurrent
-- callers never get the same run.
create function public.claim_generation_run(p_run_id uuid default null)
returns setof public.generation_runs
language plpgsql security definer set search_path = '' as $$
declare
  v_id uuid;
begin
  select id into v_id from public.generation_runs
  where status = 'queued' and run_after <= now() and (p_run_id is null or id = p_run_id)
  order by run_after
  for update skip locked
  limit 1;
  if v_id is null then
    return;
  end if;
  return query
  update public.generation_runs
  set status = 'running', attempt = attempt + 1, started_at = now(), error_code = null, error_message = null
  where id = v_id
  returning *;
end;
$$;

-- Runs left 'running' by a crashed worker go back to the queue (or fail after
-- the last attempt).
create function public.requeue_stale_runs(p_older_than interval default interval '10 minutes')
returns integer
language plpgsql security definer set search_path = '' as $$
declare
  v_count integer;
begin
  update public.generation_runs
  set status = case when attempt >= 3 then 'failed' else 'queued' end::public.generation_status,
      error_code = case when attempt >= 3 then 'timeout' end,
      error_message = case when attempt >= 3 then 'The run did not finish in time.' end,
      finished_at = case when attempt >= 3 then now() end,
      run_after = now()
  where status = 'running' and started_at < now() - p_older_than;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

-- Records a failed attempt. With p_retry_after_seconds the run goes back to
-- the queue (transient errors, up to 3 attempts); otherwise it fails.
create function public.fail_generation_run(
  p_run_id uuid,
  p_error_code text,
  p_error_message text,
  p_retry_after_seconds integer,
  p_usage jsonb
) returns public.generation_status
language plpgsql security definer set search_path = '' as $$
declare
  v_run public.generation_runs;
  v_retry boolean;
begin
  select * into v_run from public.generation_runs where id = p_run_id and status = 'running' for update;
  if not found then
    raise exception 'run is not running' using errcode = '22023';
  end if;
  v_retry := p_retry_after_seconds is not null and v_run.attempt < 3;
  update public.generation_runs
  set status = case when v_retry then 'queued' else 'failed' end::public.generation_status,
      run_after = case when v_retry then now() + make_interval(secs => p_retry_after_seconds) else run_after end,
      error_code = left(p_error_code, 60),
      error_message = left(p_error_message, 500),
      input_tokens = input_tokens + coalesce((p_usage ->> 'input_tokens')::integer, 0),
      output_tokens = output_tokens + coalesce((p_usage ->> 'output_tokens')::integer, 0),
      cache_read_tokens = cache_read_tokens + coalesce((p_usage ->> 'cache_read_tokens')::integer, 0),
      cache_write_tokens = cache_write_tokens + coalesce((p_usage ->> 'cache_write_tokens')::integer, 0),
      actual_cost_usd = coalesce(actual_cost_usd, 0) + coalesce((p_usage ->> 'cost_usd')::numeric, 0),
      finished_at = case when v_retry then null else now() end
  where id = p_run_id;
  perform private.log_event(v_run.company_id, 'generation.' || case when v_retry then 'retry_scheduled' else 'failed' end,
    'generation_run', p_run_id, jsonb_build_object('error_code', p_error_code, 'attempt', v_run.attempt), 'system');
  return case when v_retry then 'queued' else 'failed' end::public.generation_status;
end;
$$;

-- Stores a concept batch (or one regenerated concept) and marks the run
-- succeeded, in one transaction.
create function public.complete_concept_run(p_run_id uuid, p_served_model text, p_usage jsonb, p_concepts jsonb)
returns integer
language plpgsql security definer set search_path = '' as $$
declare
  v_run public.generation_runs;
  v_concept jsonb;
  v_new uuid;
  v_count integer := 0;
  v_replaces uuid;
begin
  select * into v_run from public.generation_runs where id = p_run_id and status = 'running' for update;
  if not found then
    raise exception 'run is not running' using errcode = '22023';
  end if;
  if v_run.kind not in ('concept_batch', 'concept_regen') then
    raise exception 'not a concept run' using errcode = '22023';
  end if;
  if jsonb_typeof(p_concepts) <> 'array' or jsonb_array_length(p_concepts) = 0 then
    raise exception 'no concepts' using errcode = '22023';
  end if;
  v_replaces := nullif(v_run.params ->> 'concept_id', '')::uuid;
  if v_run.kind = 'concept_regen' and (v_replaces is null or jsonb_array_length(p_concepts) <> 1) then
    raise exception 'a regeneration replaces exactly one concept' using errcode = '22023';
  end if;

  for v_concept in select * from jsonb_array_elements(p_concepts) loop
    insert into public.concepts (
      company_id, founder_id, target_month, brief_version_id, voice_profile_version_id, generation_run_id,
      title, audience, core_argument, hook, format, why_this_founder, evidence_requirements,
      needs_personal_story, fingerprint
    ) values (
      v_run.company_id, v_run.founder_id, v_run.target_month,
      (v_run.input_refs ->> 'brief_version_id')::uuid,
      nullif(v_run.input_refs ->> 'voice_profile_version_id', '')::uuid,
      v_run.id,
      v_concept ->> 'title', coalesce(v_concept ->> 'audience', ''), v_concept ->> 'core_argument',
      coalesce(v_concept ->> 'hook', ''), (v_concept ->> 'format')::public.post_format,
      coalesce(v_concept ->> 'why_this_founder', ''),
      array(select jsonb_array_elements_text(coalesce(v_concept -> 'evidence_requirements', '[]'::jsonb))),
      coalesce((v_concept ->> 'needs_personal_story')::boolean, false),
      coalesce(v_concept -> 'fingerprint', '{}'::jsonb)
    ) returning id into v_new;
    v_count := v_count + 1;
  end loop;

  if v_replaces is not null then
    update public.concepts set status = 'archived', superseded_by = v_new
    where id = v_replaces and company_id = v_run.company_id and status in ('proposed', 'selected', 'rejected');
  end if;

  update public.generation_runs
  set status = 'succeeded', finished_at = now(), served_model = p_served_model,
      input_tokens = input_tokens + coalesce((p_usage ->> 'input_tokens')::integer, 0),
      output_tokens = output_tokens + coalesce((p_usage ->> 'output_tokens')::integer, 0),
      cache_read_tokens = cache_read_tokens + coalesce((p_usage ->> 'cache_read_tokens')::integer, 0),
      cache_write_tokens = cache_write_tokens + coalesce((p_usage ->> 'cache_write_tokens')::integer, 0),
      actual_cost_usd = coalesce(actual_cost_usd, 0) + coalesce((p_usage ->> 'cost_usd')::numeric, 0)
  where id = p_run_id;
  perform private.log_event(v_run.company_id, 'generation.succeeded', 'generation_run', p_run_id,
    jsonb_build_object('concepts', v_count), 'system');
  return v_count;
end;
$$;

-- ---------------------------------------------------------------------------
-- Concept curation (admin)
-- ---------------------------------------------------------------------------

create function public.update_concept(
  p_concept_id uuid,
  p_title text,
  p_audience text,
  p_core_argument text,
  p_hook text,
  p_format public.post_format,
  p_why_this_founder text,
  p_evidence_requirements text[]
) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_company uuid := private.require_admin();
begin
  update public.concepts
  set title = btrim(p_title), audience = btrim(coalesce(p_audience, '')), core_argument = btrim(p_core_argument),
      hook = btrim(coalesce(p_hook, '')), format = p_format, why_this_founder = btrim(coalesce(p_why_this_founder, '')),
      evidence_requirements = private.clean_lines(p_evidence_requirements),
      edited_by = auth.uid(), edited_at = now()
  where id = p_concept_id and company_id = v_company and status in ('proposed', 'selected');
  if not found then
    raise exception 'concept not found or not editable' using errcode = 'P0002';
  end if;
  perform private.log_event(v_company, 'concept.edited', 'concept', p_concept_id);
end;
$$;

-- proposed ⇄ selected, either → rejected, rejected → proposed.
create function public.set_concept_status(p_concept_id uuid, p_status public.concept_status) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_company uuid := private.require_admin();
  v_from public.concept_status;
begin
  select status into v_from from public.concepts where id = p_concept_id and company_id = v_company for update;
  if not found then
    raise exception 'concept not found' using errcode = 'P0002';
  end if;
  if not (
    (v_from = 'proposed' and p_status in ('selected', 'rejected'))
    or (v_from = 'selected' and p_status in ('proposed', 'rejected'))
    or (v_from = 'rejected' and p_status = 'proposed')
  ) then
    raise exception 'a % concept cannot become %', v_from, p_status using errcode = '22023';
  end if;
  update public.concepts set status = p_status where id = p_concept_id;
  perform private.log_event(v_company, 'concept.' || p_status::text, 'concept', p_concept_id,
    jsonb_build_object('from', v_from));
end;
$$;

revoke all on function private.ai_spend_this_month(uuid) from public, anon, authenticated;

revoke all on function
  public.ai_spend_summary(),
  public.request_generation(public.generation_kind, uuid, date, text, text, text, integer, jsonb, jsonb, numeric, text),
  public.update_concept(uuid, text, text, text, text, public.post_format, text, text[]),
  public.set_concept_status(uuid, public.concept_status)
from public, anon;
grant execute on function
  public.ai_spend_summary(),
  public.request_generation(public.generation_kind, uuid, date, text, text, text, integer, jsonb, jsonb, numeric, text),
  public.update_concept(uuid, text, text, text, text, public.post_format, text, text[]),
  public.set_concept_status(uuid, public.concept_status)
to authenticated;

-- The runner's functions: the secret key only.
revoke all on function
  public.claim_generation_run(uuid),
  public.requeue_stale_runs(interval),
  public.fail_generation_run(uuid, text, text, integer, jsonb),
  public.complete_concept_run(uuid, text, jsonb, jsonb)
from public, anon, authenticated;
grant execute on function
  public.claim_generation_run(uuid),
  public.requeue_stale_runs(interval),
  public.fail_generation_run(uuid, text, text, integer, jsonb),
  public.complete_concept_run(uuid, text, jsonb, jsonb)
to service_role;
