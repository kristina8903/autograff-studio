-- Phase 2 tests: briefs, cadence rules, calendar slots (docs/PHASES.md Phase 2).
-- Dates are relative to current_date so the suite passes on any day.

begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

-- Seed: company …0001; admin a1; CEO c1 → founder f1; CTO c2 → f2; COO f3.
-- Each founder has one open-ended cadence rule from 2026-01-01; brief 2026-11 v1.
create temporary table t (key text primary key, value text);
grant all on t to public;
insert into t values
  ('next', to_char(date_trunc('month', current_date) + interval '1 month', 'YYYY-MM-DD')),
  ('plan', to_char(date_trunc('month', current_date) + interval '2 months', 'YYYY-MM-DD')),
  ('prev', to_char(date_trunc('month', current_date) - interval '1 month', 'YYYY-MM-DD'));

insert into public.companies (id, name, slug) values ('00000000-0000-4000-8000-000000000002', 'Other Co', 'other-co');
insert into public.founders (id, company_id, role_title, display_name) values
  ('00000000-0000-4000-8000-0000000000fb', '00000000-0000-4000-8000-000000000002', 'CEO', 'Other CEO');

-- ===========================================================================
-- anon
-- ===========================================================================
set local role anon;
select set_config('request.jwt.claims', '{"role":"anon"}', true);
select throws_ok('select * from public.monthly_briefs', '42501', null, 'anon cannot read briefs');
select throws_ok('select * from public.brief_versions', '42501', null, 'anon cannot read brief versions');
select throws_ok('select * from public.cadence_rules', '42501', null, 'anon cannot read cadence rules');
select throws_ok('select * from public.calendar_slots', '42501', null, 'anon cannot read slots');
select throws_ok($$select public.founder_brief('2026-11-01')$$, '42501', null, 'anon cannot call founder_brief');
reset role;

-- ===========================================================================
-- Founders: own cadence and slots only; no briefs except theme + own emphasis
-- ===========================================================================
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000c1","role":"authenticated","aal":"aal2"}', true);
select results_eq('select founder_id::text from public.cadence_rules', $$values ('00000000-0000-4000-8000-0000000000f1')$$,
  'founder sees only their own cadence rule');
select is_empty('select 1 from public.monthly_briefs', 'founder cannot read briefs');
select is_empty('select 1 from public.brief_versions', 'founder cannot read brief versions');
select results_eq($$select theme, emphasis from public.founder_brief('2026-11-01')$$,
  $$values ('Operational uncertainty in vehicle repair', 'Why software must help work progress, not just record it')$$,
  'founder sees the theme and their own emphasis');
select throws_ok($$select public.save_brief_version('2026-11-01', 'x', '{"theme":"x"}', '{}', '[]', '')$$, '42501', null, 'founder cannot save briefs');
select throws_ok($$select public.set_cadence_rule('00000000-0000-4000-8000-0000000000f1', current_date, 'week', 1, 1, null, '{2}', 0, 0, 0, 0, 0, '', current_date)$$,
  '42501', null, 'founder cannot change cadence');
select throws_ok($$select public.sync_calendar_slots('00000000-0000-4000-8000-0000000000f1', '2026-11-01', '[]', current_date)$$,
  '42501', null, 'founder cannot plan slots');
select throws_ok($$select public.add_manual_slot('00000000-0000-4000-8000-0000000000f1', current_date, '', current_date)$$,
  '42501', null, 'founder cannot add slots');
select throws_ok($$insert into public.calendar_slots (company_id, founder_id, slot_date, kind) values ('00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-0000000000f1', current_date, 'manual')$$,
  '42501', null, 'founder cannot write slots directly');
select throws_ok($$insert into public.cadence_rules (company_id, founder_id, effective_from, period, min_posts, max_posts, publishing_days) values ('00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-0000000000f1', '2030-01-01', 'week', 1, 1, '{2}')$$,
  '42501', null, 'founder cannot write cadence rules directly');

select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000c2","role":"authenticated","aal":"aal1"}', true);
select results_eq($$select theme, emphasis from public.founder_brief('2026-11-01')$$,
  $$values ('Operational uncertainty in vehicle repair', null::text)$$,
  'another founder sees the theme but not the CEO''s emphasis');
reset role;

-- ===========================================================================
-- Admin without MFA
-- ===========================================================================
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000a1","role":"authenticated","aal":"aal1"}', true);
select is_empty('select 1 from public.monthly_briefs', 'admin without MFA cannot read briefs');
select throws_ok($$select public.save_brief_version('2026-11-01', 'x', '{"theme":"x"}', '{}', '[]', '')$$, '42501', null, 'admin without MFA cannot save briefs');
reset role;

-- ===========================================================================
-- Admin with MFA: briefs
-- ===========================================================================
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000a1","role":"authenticated","aal":"aal2"}', true);

select is(public.save_brief_version('2026-11-01', 'November', '{"theme":"Operational uncertainty, revised"}',
  '{"00000000-0000-4000-8000-0000000000f2":"Engineering view"}', '["Fact"]', 'Revised theme'), 2,
  'saving a brief creates the next version');
select results_eq($$select version_no, content ->> 'theme' from public.brief_versions order by version_no$$,
  $$values (1, 'Operational uncertainty in vehicle repair'), (2, 'Operational uncertainty, revised')$$,
  'earlier versions stay readable and unchanged');
select results_eq($$select v.version_no from public.monthly_briefs b join public.brief_versions v on v.id = b.current_version_id where b.month = '2026-11-01'$$,
  $$values (2)$$, 'the brief points at the newest version');
select is(public.save_brief_version('2026-12-01', 'December', '{"theme":"Planning"}', '{}', '[]', ''), 1,
  'the first save for a new month creates version 1');
select throws_ok($$select public.save_brief_version('2026-11-15', 'x', '{"theme":"x"}', '{}', '[]', '')$$, '22023', null, 'month must be a first day');
select throws_ok($$select public.save_brief_version('2026-11-01', 'x', '{"theme":"  "}', '{}', '[]', '')$$, '23514', null, 'a theme is required');
select throws_ok($$select public.save_brief_version('2026-11-01', 'x', '{"theme":"x"}', '{"00000000-0000-4000-8000-0000000000fb":"x"}', '[]', '')$$,
  '22023', null, 'emphasis cannot name another company''s founder');
select throws_ok($$update public.brief_versions set content = '{"theme":"hacked"}'$$, '42501', null, 'admin cannot edit a version');
select ok(exists(select 1 from public.audit_events where action = 'brief.version_saved'), 'brief saves are audited');
reset role;
select throws_ok($$update public.brief_versions set change_note = 'x'$$, '42501', null, 'versions are immutable even for the owner');
select throws_ok($$delete from public.brief_versions$$, '42501', null, 'versions cannot be deleted even by the owner');

-- ===========================================================================
-- Admin with MFA: cadence rules
-- ===========================================================================
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000a1","role":"authenticated","aal":"aal2"}', true);
select throws_ok($$select public.set_cadence_rule('00000000-0000-4000-8000-0000000000f1', current_date - 3, 'week', 2, 3, null, '{2,3,4}', 0, 0, 0, 0, 0, '', current_date)$$,
  '22023', null, 'a cadence change cannot start in the past');
select throws_ok($$select public.set_cadence_rule('00000000-0000-4000-8000-0000000000f1', current_date, 'week', 2, 3, null, '{2,3,4}', 0, 0, 0, 0, 0, '', '2000-01-01')$$,
  '22023', null, 'a forged "today" is rejected');
select throws_ok($$select public.set_cadence_rule('00000000-0000-4000-8000-0000000000fb', current_date, 'week', 2, 3, null, '{2,3,4}', 0, 0, 0, 0, 0, '', current_date)$$,
  'P0002', null, 'cannot set cadence for another company''s founder');
select throws_ok($$select public.set_cadence_rule('00000000-0000-4000-8000-0000000000f1', current_date, 'week', 2, 4, null, '{2,3,4}', 0, 0, 0, 0, 0, '', current_date)$$,
  '23514', null, 'a weekly maximum cannot exceed the publishing days');
select throws_ok($$select public.set_cadence_rule('00000000-0000-4000-8000-0000000000f1', current_date, 'week', 2, 3, null, '{2,2,4}', 0, 0, 0, 0, 0, '', current_date)$$,
  '23514', null, 'publishing days must be distinct');
select throws_ok($$select public.set_cadence_rule('00000000-0000-4000-8000-0000000000f1', current_date, 'week', 2, 3, '{3,1}', '{2,3,4}', 0, 0, 0, 0, 0, '', current_date)$$,
  '23514', null, 'a weekly pattern must stay within the limits');

select lives_ok(format($$insert into t values ('rule2', public.set_cadence_rule('00000000-0000-4000-8000-0000000000f1', %L, 'week', 2, 2, null, '{2,3}', 0, 0, 0, 0, 0, 'Lighter', current_date)::text)$$,
  (select value from t where key = 'next')), 'admin starts a new CEO cadence next month');
select results_eq($$select effective_from::text, coalesce(effective_to::text, 'open') from public.cadence_rules where founder_id = '00000000-0000-4000-8000-0000000000f1' order by effective_from$$,
  format($$values ('2026-01-01', %L), (%L, 'open')$$, (select value from t where key = 'next'), (select value from t where key = 'next')),
  'the previous rule closes where the new one starts');
reset role;
select throws_ok($$insert into public.cadence_rules (company_id, founder_id, effective_from, period, min_posts, max_posts, publishing_days) values ('00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-0000000000f1', '2026-06-01', 'week', 1, 1, '{2}')$$,
  '23P01', null, 'overlapping rules are rejected by the constraint');

-- ===========================================================================
-- Admin with MFA: planning slots
-- ===========================================================================
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000a1","role":"authenticated","aal":"aal2"}', true);

-- A three-slot plan for the CEO two months ahead, under the new rule.
insert into t select 'p3', jsonb_build_array(
  jsonb_build_object('date', (d + 2)::text, 'kind', 'regular', 'rule_id', (select value from t where key = 'rule2')),
  jsonb_build_object('date', (d + 3)::text, 'kind', 'reserved_timely', 'rule_id', (select value from t where key = 'rule2')),
  jsonb_build_object('date', (d + 9)::text, 'kind', 'regular', 'rule_id', (select value from t where key = 'rule2'))
)::text from (select value::date as d from t where key = 'plan') x;

select is(public.sync_calendar_slots('00000000-0000-4000-8000-0000000000f1', (select value::date from t where key = 'plan'), (select value::jsonb from t where key = 'p3'), current_date),
  '{"created": 3, "removed": 0, "outside_cadence": []}'::jsonb, 'planning creates the slots');
select is(public.sync_calendar_slots('00000000-0000-4000-8000-0000000000f1', (select value::date from t where key = 'plan'), (select value::jsonb from t where key = 'p3'), current_date),
  '{"created": 0, "removed": 0, "outside_cadence": []}'::jsonb, 'planning again is idempotent');
select results_eq($$select count(*)::int from public.calendar_slots where founder_id = '00000000-0000-4000-8000-0000000000f1'$$, $$values (3)$$, 'no duplicate slots');

-- Fill one planned slot (drafts arrive in Phase 4) and skip another.
reset role;
update public.calendar_slots set status = 'filled', draft_id = gen_random_uuid()
 where founder_id = '00000000-0000-4000-8000-0000000000f1' and slot_date = (select value::date + 2 from t where key = 'plan');
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000a1","role":"authenticated","aal":"aal2"}', true);
select lives_ok($$select public.update_slot((select id from public.calendar_slots where founder_id = '00000000-0000-4000-8000-0000000000f1' and slot_date = (select value::date + 3 from t where key = 'plan')), 'skip', null, current_date)$$,
  'admin skips an open slot');
select lives_ok($$select public.add_manual_slot('00000000-0000-4000-8000-0000000000f1', (select value::date + 20 from t where key = 'plan'), 'Launch', current_date)$$,
  'admin adds a manual slot');

-- Re-plan with an empty plan: only the open planned slot goes.
select is(public.sync_calendar_slots('00000000-0000-4000-8000-0000000000f1', (select value::date from t where key = 'plan'), '[]', current_date),
  jsonb_build_object('created', 0, 'removed', 1, 'outside_cadence', jsonb_build_array((select value::date + 2 from t where key = 'plan'))),
  're-planning removes only open planned slots and reports filled ones outside the plan');
select results_eq($$select kind::text, status::text from public.calendar_slots where founder_id = '00000000-0000-4000-8000-0000000000f1' order by slot_date$$,
  $$values ('regular', 'filled'), ('reserved_timely', 'skipped'), ('manual', 'open')$$,
  'filled, skipped and manual slots are untouched');
select is(public.sync_calendar_slots('00000000-0000-4000-8000-0000000000f1', (select value::date from t where key = 'plan'), (select value::jsonb from t where key = 'p3'), current_date) ->> 'created',
  '1', 'skipped and filled dates are not recreated; only the free date is');

-- Past slots are never touched by planning.
reset role;
insert into public.calendar_slots (company_id, founder_id, slot_date, kind, cadence_rule_id)
select '00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-0000000000f2', value::date + 1, 'regular',
       (select id from public.cadence_rules where founder_id = '00000000-0000-4000-8000-0000000000f2')
from t where key = 'prev';
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000a1","role":"authenticated","aal":"aal2"}', true);
select is(public.sync_calendar_slots('00000000-0000-4000-8000-0000000000f2', (select value::date from t where key = 'prev'), '[]', current_date) ->> 'removed',
  '0', 'planning a past month removes nothing');

-- Invalid plans.
select throws_ok(format($$select public.sync_calendar_slots('00000000-0000-4000-8000-0000000000f1', %L, '[{"date":"2001-01-01","kind":"regular","rule_id":%s}]', current_date)$$,
  (select value from t where key = 'plan'), to_json((select value from t where key = 'rule2'))), '22023', null, 'a slot outside the month is rejected');
select throws_ok(format($$select public.sync_calendar_slots('00000000-0000-4000-8000-0000000000f1', %L, %L, current_date)$$,
  (select value from t where key = 'plan'),
  jsonb_build_array(jsonb_build_object('date', (select value::date + 5 from t where key = 'plan'), 'kind', 'regular',
    'rule_id', (select id from public.cadence_rules where founder_id = '00000000-0000-4000-8000-0000000000f2')))),
  '22023', null, 'a slot must use a rule of this founder in effect on its date');
select throws_ok(format($$select public.sync_calendar_slots('00000000-0000-4000-8000-0000000000f1', %L, %L, current_date)$$,
  (select value from t where key = 'plan'),
  jsonb_build_array(
    jsonb_build_object('date', (select value::date + 5 from t where key = 'plan'), 'kind', 'regular', 'rule_id', (select value from t where key = 'rule2')),
    jsonb_build_object('date', (select value::date + 5 from t where key = 'plan'), 'kind', 'regular', 'rule_id', (select value from t where key = 'rule2')))),
  '22023', null, 'the same date cannot be planned twice');
select throws_ok($$select public.sync_calendar_slots('00000000-0000-4000-8000-0000000000fb', '2026-11-01', '[]', current_date)$$,
  'P0002', null, 'cannot plan another company''s founder');

-- Moving and deleting.
select lives_ok($$select public.update_slot((select id from public.calendar_slots where founder_id = '00000000-0000-4000-8000-0000000000f1' and kind = 'regular' and status = 'open'), 'move', (select value::date + 15 from t where key = 'plan'), current_date)$$,
  'admin moves a planned slot');
select results_eq($$select count(*)::int from public.calendar_slots where founder_id = '00000000-0000-4000-8000-0000000000f1' and kind = 'manual' and note like 'moved from %'$$,
  $$values (1)$$, 'moving a planned slot skips it and adds a manual slot on the new date');
select throws_ok($$select public.update_slot((select id from public.calendar_slots where founder_id = '00000000-0000-4000-8000-0000000000f1' and kind = 'reserved_timely'), 'delete', null, current_date)$$,
  '22023', null, 'planned slots cannot be deleted, only skipped');
select throws_ok($$select public.update_slot((select id from public.calendar_slots where founder_id = '00000000-0000-4000-8000-0000000000f1' and status = 'filled'), 'skip', null, current_date)$$,
  '22023', null, 'a filled slot cannot be skipped');
select throws_ok($$select public.add_manual_slot('00000000-0000-4000-8000-0000000000f1', current_date - 2, '', current_date)$$,
  '22023', null, 'slots cannot be added in the past');
select lives_ok($$select public.update_slot((select id from public.calendar_slots where note = 'Launch'), 'delete', null, current_date)$$,
  'admin deletes a manual slot');
select ok(exists(select 1 from public.audit_events where action = 'calendar.slot_moved'), 'slot changes are audited');

-- Coverage counts under row-level security.
select results_eq(format($$select required, reserved_timely, open, filled, skipped from public.coverage_slot_counts('00000000-0000-4000-8000-0000000000f1', %L)$$,
  (select value from t where key = 'plan')),
  $$select count(*) filter (where status <> 'skipped')::int, count(*) filter (where status <> 'skipped' and kind = 'reserved_timely')::int,
           count(*) filter (where status = 'open')::int, count(*) filter (where status = 'filled')::int, count(*) filter (where status = 'skipped')::int
    from public.calendar_slots where founder_id = '00000000-0000-4000-8000-0000000000f1'$$,
  'coverage counts match the slots');
reset role;

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000c2","role":"authenticated","aal":"aal1"}', true);
select is_empty($$select 1 from public.calendar_slots where founder_id = '00000000-0000-4000-8000-0000000000f1'$$, 'founder B cannot read founder A''s slots');
select results_eq(format($$select required from public.coverage_slot_counts('00000000-0000-4000-8000-0000000000f1', %L)$$, (select value from t where key = 'plan')),
  $$values (0)$$, 'founder B gets no coverage numbers for founder A');
reset role;

select * from finish();
rollback;
