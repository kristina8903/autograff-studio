-- Phase 4a tests: generation runs, budgets, the job runner's functions, concepts.

begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

-- Seed: admin a1; CEO c1 → f1; brief 2026-11 v1 (…b1); CEO voice v1 (…d1).
-- Default ceilings: $10 a month, $2 a run.
create temporary table ids (key text primary key, value uuid);
grant all on ids to public;

create function pg_temp.request(p_key text, p_cost numeric, p_kind public.generation_kind default 'concept_batch',
  p_params jsonb default '{"count": 2}')
returns table (run_id uuid, run_status public.generation_status, message text)
language sql as $$
  select * from public.request_generation(p_kind, '00000000-0000-4000-8000-0000000000f1', '2026-11-01', 'fake',
    'claude-opus-5-5', 'concepts', 1,
    '{"brief_version_id": "00000000-0000-4000-8000-0000000000b1", "voice_profile_version_id": "00000000-0000-4000-8000-0000000000d1", "example_ids": []}',
    p_params, p_cost, p_key);
$$;
grant execute on function pg_temp.request(text, numeric, public.generation_kind, jsonb) to public;

create function pg_temp.concepts(n integer) returns jsonb language sql as $$
  select jsonb_agg(jsonb_build_object(
    'title', 'Concept ' || i, 'audience', 'Fleet leads', 'core_argument', 'Argument ' || i, 'hook', 'Hook ' || i,
    'format', 'story', 'why_this_founder', 'Experience', 'evidence_requirements', jsonb_build_array('A figure'),
    'needs_personal_story', i = 1, 'fingerprint', jsonb_build_object('argument_key', 'k' || i)))
  from generate_series(1, n) i;
$$;
grant execute on function pg_temp.concepts(integer) to public;

-- ===========================================================================
-- anon and founders: nothing
-- ===========================================================================
set local role anon;
select set_config('request.jwt.claims', '{"role":"anon"}', true);
select throws_ok('select * from public.generation_runs', '42501', null, 'anon cannot read runs');
select throws_ok('select * from public.concepts', '42501', null, 'anon cannot read concepts');
select throws_ok($$select * from pg_temp.request('anon-key-0000000001', 0.1)$$, '42501', null, 'anon cannot request runs');
reset role;

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000c1","role":"authenticated","aal":"aal2"}', true);
select throws_ok($$select * from pg_temp.request('founder-key-00000001', 0.1)$$, '42501', null, 'a founder cannot request runs');
select throws_ok('select * from public.ai_spend_summary()', '42501', null, 'a founder cannot see AI spend');
select throws_ok('select * from public.claim_generation_run()', '42501', null, 'a founder cannot claim runs');
reset role;

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000a1","role":"authenticated","aal":"aal1"}', true);
select throws_ok($$select * from pg_temp.request('nomfa-key-000000001', 0.1)$$, '42501', null, 'admin without MFA cannot request runs');
reset role;

-- ===========================================================================
-- Admin: requests, idempotency, ceilings
-- ===========================================================================
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000a1","role":"authenticated","aal":"aal2"}', true);

insert into ids select 'run1', run_id from pg_temp.request('click-0000000000001', 0.40);
select results_eq($$select status::text, estimated_cost_usd from public.generation_runs where id = (select value from ids where key = 'run1')$$,
  $$values ('queued', 0.40::numeric)$$, 'a run within budget is queued');
select results_eq($$select run_id, message from pg_temp.request('click-0000000000001', 0.40)$$,
  $$select (select value from ids where key = 'run1'), 'already requested'::text$$, 'the same key returns the same run');
select is((select count(*)::int from public.generation_runs), 1, 'double-submitting creates one run');

select results_eq($$select run_status::text, message from pg_temp.request('click-0000000000002', 2.50)$$,
  $$values ('refused', 'This run could cost up to $2.50, over the $2.00 per-run ceiling.')$$,
  'a run over the per-run ceiling is refused');
select results_eq($$select status::text, error_code, finished_at is not null from public.generation_runs where idempotency_key = 'click-0000000000002'$$,
  $$values ('refused', 'budget', true)$$, 'the refused run is recorded and visible');

select results_eq($$select spent_usd, monthly_budget_usd, per_run_ceiling_usd from public.ai_spend_summary()$$,
  $$values (0.40::numeric, 10.00::numeric, 2.00::numeric)$$, 'queued runs count at their estimate');

select throws_ok($$update public.settings set ai_monthly_budget_usd = 50$$, '42501', null, 'the admin cannot raise the budget');
select lives_ok($$update public.settings set allowed_email_domains = '{autograff.ai}'$$, 'the admin can still edit email domains');
reset role;

select throws_ok($$update public.settings set ai_monthly_budget_usd = 51$$, '23514', null, 'the budget can never exceed $50, even for the owner');

-- ===========================================================================
-- Runner (service_role): claim, complete, fail, retry
-- ===========================================================================
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000a1","role":"authenticated","aal":"aal2"}', true);
select throws_ok(format($$select public.complete_concept_run(%L, 'm', '{}', '[]')$$, (select value from ids where key = 'run1')),
  '42501', null, 'the admin cannot record results directly');
reset role;

set local role service_role;
select results_eq('select id, status::text, attempt from public.claim_generation_run()',
  $$select (select value from ids where key = 'run1'), 'running', 1::smallint$$, 'the runner claims the queued run');
select is_empty('select * from public.claim_generation_run()', 'a running run cannot be claimed twice');

select is(public.complete_concept_run((select value from ids where key = 'run1'), 'claude-opus-5-5',
  '{"input_tokens": 3000, "output_tokens": 2000, "cost_usd": 0.052}', pg_temp.concepts(2)), 2, 'the batch is stored');
select results_eq($$select status::text, served_model, actual_cost_usd, input_tokens from public.generation_runs where id = (select value from ids where key = 'run1')$$,
  $$values ('succeeded', 'claude-opus-5-5', 0.052::numeric, 3000)$$, 'the run records model, tokens and cost');
select results_eq($$select count(*)::int, bool_and(brief_version_id = '00000000-0000-4000-8000-0000000000b1'),
    bool_and(voice_profile_version_id = '00000000-0000-4000-8000-0000000000d1'), bool_and(status = 'proposed')
  from public.concepts where generation_run_id = (select value from ids where key = 'run1')$$,
  $$values (2, true, true, true)$$, 'each concept records the brief and voice versions it was based on');
select throws_ok(format($$select public.complete_concept_run(%L, 'm', '{}', pg_temp.concepts(1))$$, (select value from ids where key = 'run1')),
  '22023', null, 'a finished run cannot be completed again');
reset role;

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000a1","role":"authenticated","aal":"aal2"}', true);
select results_eq($$select spent_usd from public.ai_spend_summary()$$, $$values (0.052::numeric)$$,
  'spend counts the actual cost once finished');
insert into ids select 'run2', run_id from pg_temp.request('click-0000000000003', 0.30);
reset role;

set local role service_role;
select is((select id from public.claim_generation_run()), (select value from ids where key = 'run2'), 'claim run 2');
select is(public.fail_generation_run((select value from ids where key = 'run2'), 'rate_limited', 'busy', 30, '{}'), 'queued'::public.generation_status,
  'a transient failure goes back to the queue');
select is_empty('select * from public.claim_generation_run()', 'it is not claimed before its retry time');
reset role;
update public.generation_runs set run_after = now() where id = (select value from ids where key = 'run2');
set local role service_role;
select is((select attempt from public.claim_generation_run()), 2::smallint, 'the retry is attempt 2');
select is(public.fail_generation_run((select value from ids where key = 'run2'), 'server', 'error', 5, '{"cost_usd": 0.01}'), 'queued'::public.generation_status, 'retry again');
reset role;
update public.generation_runs set run_after = now() where id = (select value from ids where key = 'run2');
set local role service_role;
select is((select attempt from public.claim_generation_run()), 3::smallint, 'attempt 3');
select is(public.fail_generation_run((select value from ids where key = 'run2'), 'server', 'error', 5, '{"cost_usd": 0.01}'), 'failed'::public.generation_status,
  'after three attempts the run fails even for a transient error');
select results_eq($$select status::text, actual_cost_usd, finished_at is not null from public.generation_runs where id = (select value from ids where key = 'run2')$$,
  $$values ('failed', 0.02::numeric, true)$$, 'tokens billed by failed attempts still count');
reset role;

-- A worker that died: its run is requeued.
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000a1","role":"authenticated","aal":"aal2"}', true);
insert into ids select 'run3', run_id from pg_temp.request('click-0000000000004', 0.30);
reset role;
set local role service_role;
select lives_ok('select * from public.claim_generation_run()', 'claim run 3');
reset role;
update public.generation_runs set started_at = now() - interval '11 minutes' where id = (select value from ids where key = 'run3');
set local role service_role;
select is(public.requeue_stale_runs(), 1, 'a stale running run is requeued');
select is((select status::text from public.generation_runs where id = (select value from ids where key = 'run3')), 'queued', 'and is queued again');
reset role;

-- ===========================================================================
-- Monthly budget
-- ===========================================================================
update public.settings set ai_monthly_budget_usd = 1;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000a1","role":"authenticated","aal":"aal2"}', true);
select results_eq($$select run_status::text from pg_temp.request('click-0000000000005', 0.90)$$,
  $$values ('refused')$$, 'a run that would pass the monthly budget is refused');
select matches((select error_message from public.generation_runs where idempotency_key = 'click-0000000000005'),
  'monthly budget is already used', 'with a reason naming the monthly budget');
reset role;
update public.settings set ai_monthly_budget_usd = 10;

-- ===========================================================================
-- Concepts: curation and regeneration
-- ===========================================================================
insert into ids select 'c1', id from public.concepts where title = 'Concept 1';
insert into ids select 'c2', id from public.concepts where title = 'Concept 2';

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000c1","role":"authenticated","aal":"aal2"}', true);
select is_empty('select 1 from public.concepts', 'founders never see concepts (D-13)');
select is_empty('select 1 from public.generation_runs', 'founders never see runs or costs');
select throws_ok(format($$select public.set_concept_status(%L, 'selected')$$, (select value from ids where key = 'c1')),
  '42501', null, 'a founder cannot select concepts');
reset role;

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000a1","role":"authenticated","aal":"aal2"}', true);
select lives_ok(format($$select public.set_concept_status(%L, 'selected')$$, (select value from ids where key = 'c1')), 'select a concept');
select lives_ok(format($$select public.set_concept_status(%L, 'rejected')$$, (select value from ids where key = 'c2')), 'reject a concept');
select throws_ok(format($$select public.set_concept_status(%L, 'selected')$$, (select value from ids where key = 'c2')),
  '22023', null, 'a rejected concept must be restored before it is selected');
select throws_ok(format($$select public.set_concept_status(%L, 'drafted')$$, (select value from ids where key = 'c1')),
  '22023', null, 'drafted is set by drafting, not by hand');
select lives_ok(format($$select public.update_concept(%L, ' New title ', 'Ops', 'New argument', '', 'how_to', '', '{" Need a figure ", ""}')$$,
  (select value from ids where key = 'c1')), 'edit a selected concept');
select results_eq(format($$select title, format::text, evidence_requirements, edited_by::text from public.concepts where id = %L$$, (select value from ids where key = 'c1')),
  $$values ('New title', 'how_to', '{"Need a figure"}'::text[], '00000000-0000-4000-8000-0000000000a1')$$, 'the edit is saved and attributed');
select throws_ok(format($$select public.update_concept(%L, 'x', '', 'y', '', 'story', '', '{}')$$, (select value from ids where key = 'c2')),
  'P0002', null, 'a rejected concept cannot be edited');
select throws_ok($$update public.concepts set title = 'direct'$$, '42501', null, 'concepts cannot be written directly');

insert into ids select 'regen', run_id from pg_temp.request('click-0000000000006', 0.20, 'concept_regen',
  jsonb_build_object('concept_id', (select value from ids where key = 'c1'), 'guidance', 'More practical'));
reset role;

set local role service_role;
select is((select id from public.claim_generation_run()), (select value from ids where key = 'run3'), 'the older requeued run is claimed first');
select is((select id from public.claim_generation_run()), (select value from ids where key = 'regen'), 'then the regeneration');
select throws_ok(format($$select public.complete_concept_run(%L, 'm', '{}', pg_temp.concepts(2))$$, (select value from ids where key = 'regen')),
  '22023', null, 'a regeneration must return exactly one concept');
select is(public.complete_concept_run((select value from ids where key = 'regen'), 'claude-opus-5-5', '{}', pg_temp.concepts(1)), 1,
  'the regenerated concept is stored');
reset role;

select results_eq(format($$select status::text, superseded_by is not null from public.concepts where id = %L$$, (select value from ids where key = 'c1')),
  $$values ('archived', true)$$, 'the old concept is kept, archived and linked to its replacement');
select results_eq(format($$select status::text from public.concepts where id = %L$$, (select value from ids where key = 'c2')),
  $$values ('rejected')$$, 'other concepts are untouched');
select is((select count(*)::int from public.audit_events where action like 'generation.%' or action like 'concept.%') > 10, true,
  'requests, results and curation are audited');

select * from finish();
rollback;
