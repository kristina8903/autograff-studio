-- Phase 5 tests: research queries, sources and findings; review; domain lists;
-- claims citing findings; founders seeing the sources of their own drafts.

begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

-- Seed: company …001; admin a1; CEO c1 → f1; CTO c2 → f2; brief 2026-11 v1 (…b1).
create temporary table ids (key text primary key, value uuid);
grant all on ids to public;
create function pg_temp.id(p_key text) returns uuid language sql stable as $$ select value from ids where key = p_key $$;
grant execute on function pg_temp.id(text) to public;
create function pg_temp.as_user(p_sub text, p_aal text default 'aal1') returns void language sql as $$
  select set_config('request.jwt.claims',
    jsonb_build_object('sub', p_sub, 'role', 'authenticated', 'aal', p_aal)::text, true);
$$;
grant execute on function pg_temp.as_user(text, text) to public;

create function pg_temp.source(p_url text, p_canonical text, p_excerpt text, p_findings jsonb) returns jsonb language sql as $$
  select jsonb_build_object('url', p_url, 'canonical_url', p_canonical, 'title', 'Fleet Repair Report',
    'publisher', 'fleetresearch.example.org', 'page_age', 'March 4, 2026', 'published_at', '2026-03-04',
    'published_at_precision', 'day', 'excerpt', p_excerpt, 'findings', p_findings);
$$;
grant execute on function pg_temp.source(text, text, text, jsonb) to public;

-- Requests a research run as the admin, then runs it as the runner with the given payload.
create function pg_temp.research(p_query text, p_key text, p_payload jsonb, p_concept uuid default null) returns uuid
language plpgsql as $$
declare
  v_run uuid;
begin
  perform set_config('role', 'authenticated', true);
  perform pg_temp.as_user('00000000-0000-4000-8000-0000000000a1', 'aal2');
  select run_id into v_run from public.request_generation('research', null, '2026-11-01', 'fake', 'claude-sonnet-5-5',
    'findings', 1, '{}', jsonb_build_object('query', p_query) || coalesce(jsonb_build_object('concept_id', p_concept), '{}'),
    0.4, p_key);
  perform set_config('role', 'service_role', true);
  perform public.claim_generation_run(v_run);
  perform public.complete_research_run(v_run, 'claude-sonnet-5-5',
    '{"input_tokens": 12000, "output_tokens": 900, "cost_usd": 0.05, "web_searches": 2}', p_payload);
  perform set_config('role', 'postgres', true);
  return v_run;
end;
$$;

insert into ids select 'run1', pg_temp.research('repair approval delays', 'research-key-000001', jsonb_build_object(
  'findings_rejected', 1,
  'sources', jsonb_build_array(
    pg_temp.source('https://www.fleetresearch.example.org/report?utm_source=x', 'https://fleetresearch.example.org/report',
      'About 27% of delays came from waiting for approvals, a survey of 1,200 fleets found.',
      jsonb_build_array(
        jsonb_build_object('claim_text', 'About 27% of repair delays came from waiting for approvals.',
          'quote', 'About 27% of delays came from waiting for approvals', 'data', jsonb_build_object('value', '27', 'unit', '%'),
          'event_date', '2025-01-01', 'event_date_precision', 'year', 'verification_status', 'machine_supported'),
        -- The runner never sends a person's status; if it did, it is dropped.
        jsonb_build_object('claim_text', 'Smuggled as verified.', 'verification_status', 'human_verified'))),
    jsonb_build_object('url', 'https://shopnews.example.com/blog', 'canonical_url', 'https://shopnews.example.com/blog',
      'title', 'Why approvals stall repairs', 'publisher', 'shopnews.example.com', 'page_age', null,
      'published_at', null, 'published_at_precision', 'unknown',
      'excerpt', 'Approvals are a common cause of delay.',
      'findings', jsonb_build_array(jsonb_build_object('claim_text', 'Approvals are a common cause of repair delays.',
        'quote', null, 'data', null, 'event_date', null, 'event_date_precision', 'unknown', 'verification_status', 'unverified')))
  )));
insert into ids select 'query1', id from public.research_queries where generation_run_id = pg_temp.id('run1');
insert into ids select 'source1', id from public.research_sources where canonical_url = 'https://fleetresearch.example.org/report';
insert into ids select 'source2', id from public.research_sources where canonical_url = 'https://shopnews.example.com/blog';
insert into ids select 'finding1', id from public.research_findings where source_id = pg_temp.id('source1');
insert into ids select 'finding2', id from public.research_findings where source_id = pg_temp.id('source2');

-- ===========================================================================
-- Storing a run
-- ===========================================================================
select results_eq(format($$select query_text, sources_found, sources_already_stored, findings_rejected, provider from public.research_queries where id = %L$$, pg_temp.id('query1')),
  $$values ('repair approval delays', 2, 0, 1, 'fake')$$, 'the query is stored with its counts');
select results_eq(format($$select status::text, web_searches, actual_cost_usd from public.generation_runs where id = %L$$, pg_temp.id('run1')),
  $$values ('succeeded', 2, 0.05::numeric)$$, 'the run records its searches and cost (searches included)');
select results_eq(format($$select url, title, publisher, published_at, published_at_precision::text, page_age_raw, status::text, source_tier::text,
    retrieved_at is not null, content_hash = sha256(convert_to(excerpt, 'UTF8')) from public.research_sources where id = %L$$, pg_temp.id('source1')),
  $$values ('https://www.fleetresearch.example.org/report?utm_source=x', 'Fleet Repair Report', 'fleetresearch.example.org', '2026-03-04'::date,
    'day', 'March 4, 2026', 'candidate', 'unknown', true, true)$$,
  'criterion 1: URL, title, publisher, published date, retrieval date and excerpt are stored');
select results_eq(format($$select published_at, published_at_precision::text from public.research_sources where id = %L$$, pg_temp.id('source2')),
  $$values (null::date, 'unknown')$$, 'a page without a date is stored as "unknown", never guessed');
select results_eq(format($$select verification_status::text, event_date, event_date_precision::text, data ->> 'value' from public.research_findings where source_id = %L$$, pg_temp.id('source1')),
  $$values ('machine_supported', '2025-01-01'::date, 'year', '27')$$,
  'only checked findings are stored; a status only a person may set is dropped');
select is((select verification_status::text from public.research_findings where id = pg_temp.id('finding2')), 'unverified',
  'a finding with no quote or number waits for a person');

-- The same page found again is kept as it was.
insert into ids select 'run2', pg_temp.research('approvals again', 'research-key-000002', jsonb_build_object('sources', jsonb_build_array(
  pg_temp.source('https://fleetresearch.example.org/report', 'https://fleetresearch.example.org/report', 'Different text now 99%.',
    jsonb_build_array(jsonb_build_object('claim_text', '99% of something.', 'verification_status', 'machine_supported'))))));
select results_eq(format($$select sources_found, sources_already_stored from public.research_queries where generation_run_id = %L$$, pg_temp.id('run2')),
  $$values (0, 1)$$, 'a page already stored is counted, not duplicated');
select is((select excerpt from public.research_sources where id = pg_temp.id('source1')),
  'About 27% of delays came from waiting for approvals, a survey of 1,200 fleets found.',
  'its excerpt, which its findings were checked against, is unchanged');
select is((select count(*)::int from public.research_findings where source_id = pg_temp.id('source1')), 1, 'and no findings are added to it');

select throws_ok($$insert into public.research_sources (company_id, url, canonical_url, excerpt, content_hash, provider, research_query_id)
  values ('00000000-0000-4000-8000-000000000001', 'javascript:alert(1)', 'https://x.example', 'x', '\x00', 'fake', pg_temp.id('query1'))$$,
  '23514', null, 'a source URL must be a web address');
select throws_ok(format($$update public.research_findings set verification_status = 'human_verified' where id = %L$$, pg_temp.id('finding1')),
  '23514', null, 'nothing marks a finding verified without a person');

-- ===========================================================================
-- Access
-- ===========================================================================
set local role anon;
select set_config('request.jwt.claims', '{"role":"anon"}', true);
select throws_ok('select * from public.research_sources', '42501', null, 'anon cannot read sources');
select throws_ok('select * from public.research_findings', '42501', null, 'anon cannot read findings');
select throws_ok('select * from public.research_queries', '42501', null, 'anon cannot read queries');
reset role;

set local role authenticated;
select pg_temp.as_user('00000000-0000-4000-8000-0000000000c1');
select is_empty('select 1 from public.research_sources', 'a founder cannot read sources directly');
select is_empty('select 1 from public.research_findings', 'nor findings');
select is_empty('select 1 from public.research_queries', 'nor queries');
select throws_ok(format($$select public.review_research_source(%L, 'accepted', 'primary', '')$$, pg_temp.id('source1')), '42501', null,
  'a founder cannot review sources');
select throws_ok(format($$select public.review_research_finding(%L, 'human_verified', '')$$, pg_temp.id('finding1')), '42501', null,
  'nor verify findings');
select throws_ok($$select public.set_research_domains('{}', '{}')$$, '42501', null, 'nor change the domain lists');
select throws_ok(format($$select public.complete_research_run(%L, 'm', '{}', '{}')$$, pg_temp.id('run1')), '42501', null,
  'only the runner stores research');
reset role;

set local role authenticated;
select pg_temp.as_user('00000000-0000-4000-8000-0000000000a1', 'aal1');
select is_empty('select 1 from public.research_sources', 'an admin without MFA sees nothing');
reset role;

-- ===========================================================================
-- Review
-- ===========================================================================
set local role authenticated;
select pg_temp.as_user('00000000-0000-4000-8000-0000000000a1', 'aal2');
select throws_ok(format($$select public.review_research_finding(%L, 'human_verified', '')$$, pg_temp.id('finding1')), '22023',
  'accept the source before verifying its findings', 'a finding of an unaccepted source cannot be verified');
select lives_ok(format($$select public.review_research_source(%L, 'accepted', 'reputable_publication', 'Known trade survey')$$, pg_temp.id('source1')),
  'the admin accepts the source and rates it');
select lives_ok(format($$select public.review_research_finding(%L, 'human_verified', 'Checked the report')$$, pg_temp.id('finding1')),
  'and verifies the finding');
select throws_ok(format($$select public.review_research_finding(%L, 'disputed', 'no')$$, pg_temp.id('finding2')), '22023', null,
  'a dispute needs a reason');
select throws_ok(format($$select public.review_research_finding(%L, 'machine_supported', '')$$, pg_temp.id('finding2')), '22023', null,
  'a person cannot set the machine status');
select lives_ok(format($$select public.link_research_findings(%L, %L, true)$$, pg_temp.id('finding1'), pg_temp.id('finding2')),
  'two findings are linked as conflicting');
reset role;
select results_eq(format($$select status::text, source_tier::text, review_note, reviewed_by::text from public.research_sources where id = %L$$, pg_temp.id('source1')),
  $$values ('accepted', 'reputable_publication', 'Known trade survey', '00000000-0000-4000-8000-0000000000a1')$$, 'the review is recorded');
select results_eq(format($$select verification_status::text, verified_by::text, verified_at is not null from public.research_findings where id = %L$$, pg_temp.id('finding1')),
  $$values ('human_verified', '00000000-0000-4000-8000-0000000000a1', true)$$, 'the verification records who and when');
select results_eq(format($$select (select conflicts_with from public.research_findings where id = %L) = array[%L]::uuid[],
    (select conflicts_with from public.research_findings where id = %L) = array[%L]::uuid[]$$,
    pg_temp.id('finding1'), pg_temp.id('finding2'), pg_temp.id('finding2'), pg_temp.id('finding1')),
  $$values (true, true)$$, 'the link is on both sides');
set local role authenticated;
select pg_temp.as_user('00000000-0000-4000-8000-0000000000a1', 'aal2');
select lives_ok(format($$select public.link_research_findings(%L, %L, false)$$, pg_temp.id('finding2'), pg_temp.id('finding1')), 'and can be removed');
select throws_ok(format($$select public.link_research_findings(%L, %L, true)$$, pg_temp.id('finding1'), pg_temp.id('finding1')), 'P0002', null,
  'a finding cannot conflict with itself');
select throws_ok($$select public.set_research_domains(array['census.gov', 'https://bad.example/x'], '{}')$$, '22023', null,
  'domain lists take bare domains only');
select lives_ok($$select public.set_research_domains(array['census.gov'], array['spam.example.com'])$$, 'domain lists saved');
reset role;
select is((select cardinality(conflicts_with) from public.research_findings where id = pg_temp.id('finding1')), 0, 'unlinked on both sides');
select results_eq($$select research_allowed_domains, research_blocked_domains from public.settings$$,
  $$values (array['census.gov'], array['spam.example.com'])$$, 'the lists are stored');
select results_eq($$select action, count(*)::int from public.audit_events
    where action like 'research.%' or action = 'settings.research_domains' group by action order by action$$,
  $$values ('research.completed', 2), ('research.conflict_linked', 1), ('research.conflict_unlinked', 1),
    ('research.finding_human_verified', 1), ('research.source_accepted', 1), ('settings.research_domains', 1)$$,
  'research activity is audited (refused calls change nothing)');

-- ===========================================================================
-- Claims cite findings; founders see the sources of their own drafts
-- ===========================================================================
insert into public.concepts (company_id, founder_id, target_month, brief_version_id, title, core_argument, format, status, fingerprint)
values ('00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-0000000000f1', '2026-11-01',
  '00000000-0000-4000-8000-0000000000b1', 'Approvals concept', 'Approvals stall repairs', 'story', 'selected', '{}');
insert into ids select 'concept', id from public.concepts where title = 'Approvals concept';

create function pg_temp.write_draft() returns uuid language plpgsql as $$
declare
  v_run uuid;
  v_version uuid;
begin
  perform set_config('role', 'authenticated', true);
  perform pg_temp.as_user('00000000-0000-4000-8000-0000000000a1', 'aal2');
  select run_id into v_run from public.request_generation('draft', '00000000-0000-4000-8000-0000000000f1', '2026-11-01', 'fake',
    'claude-opus-5-5', 'draft', 2,
    '{"brief_version_id": "00000000-0000-4000-8000-0000000000b1", "voice_profile_version_id": null, "example_ids": []}',
    jsonb_build_object('concept_id', pg_temp.id('concept')), 0.4, 'research-draft-key-01');
  perform set_config('role', 'service_role', true);
  perform public.claim_generation_run(v_run);
  v_version := public.complete_draft_run(v_run, 'claude-opus-5-5', '{}', jsonb_build_object(
    'body', E'About 27% of repair delays came from waiting for approvals.\n\nThat is fixable.',
    'alternative_hooks', '[]'::jsonb, 'rationale', 'r', 'fingerprint', '{}'::jsonb, 'flags', '[]'::jsonb, 'checks', '[]'::jsonb,
    'claims', jsonb_build_array(
      jsonb_build_object('claim_text', 'About 27% of repair delays came from waiting for approvals', 'claim_kind', 'sourced_fact',
        'span_start', 0, 'span_end', 59, 'approved_fact', null, 'finding_id', pg_temp.id('finding1'), 'support_status', 'supported'),
      jsonb_build_object('claim_text', 'That is fixable', 'claim_kind', 'sourced_fact', 'span_start', 62, 'span_end', 77,
        'approved_fact', null, 'finding_id', gen_random_uuid(), 'support_status', 'unsupported'))));
  perform set_config('role', 'postgres', true);
  return (select draft_id from public.draft_versions where id = v_version);
end;
$$;
insert into ids select 'draft', pg_temp.write_draft();
select results_eq(format($$select claim_text, finding_id::text from public.draft_claims where draft_version_id = (select current_version_id from public.drafts where id = %L) order by span_start$$, pg_temp.id('draft')),
  format($$values ('About 27%% of repair delays came from waiting for approvals', %L), ('That is fixable', null::text)$$, pg_temp.id('finding1')),
  'a claim stores the finding it cites; an unknown finding id is dropped');

set local role authenticated;
select pg_temp.as_user('00000000-0000-4000-8000-0000000000c1');
select is_empty(format('select * from public.founder_draft_sources(%L)', pg_temp.id('draft')), 'no sources before the draft is shared');
reset role;
set local role authenticated;
select pg_temp.as_user('00000000-0000-4000-8000-0000000000a1', 'aal2');
select lives_ok(format($$select public.share_draft(%L, '{}')$$, pg_temp.id('draft')), 'shared with the founder');
reset role;

set local role authenticated;
select pg_temp.as_user('00000000-0000-4000-8000-0000000000c1');
select results_eq(format('select claim_text, support_status::text, source_title, source_url, publisher, published_at, finding_quote from public.founder_draft_sources(%L)', pg_temp.id('draft')),
  $$values ('About 27% of repair delays came from waiting for approvals', 'supported', 'Fleet Repair Report',
      'https://www.fleetresearch.example.org/report?utm_source=x', 'fleetresearch.example.org', '2026-03-04'::date,
      'About 27% of delays came from waiting for approvals'),
    ('That is fixable', 'unsupported', null, null, null, null::date, null)$$,
  'criterion 3: the founder sees each claim with its source, or that it has none');
select is(public.founder_save_version(pg_temp.id('draft'),
  E'About 27% of repair delays came from waiting for approvals.\n\nThat is very fixable.', ''), 2, 'the founder edits');
select results_eq(format('select claim_text, source_title from public.founder_draft_sources(%L)', pg_temp.id('draft')),
  $$values ('About 27% of repair delays came from waiting for approvals', 'Fleet Repair Report')$$,
  'a claim still in the text keeps its source; one edited away is gone');
reset role;

set local role authenticated;
select pg_temp.as_user('00000000-0000-4000-8000-0000000000c2');
select is_empty(format('select * from public.founder_draft_sources(%L)', pg_temp.id('draft')), 'another founder sees no sources of this draft');
reset role;

select * from finish();
rollback;
