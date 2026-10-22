-- Phase 7 tests: sharing, founder access, comments, approval and its hash
-- binding, material-edit invalidation, rewrites, feedback from founder edits.

begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

-- Seed: company …001; admin a1; CEO c1 → f1; CTO c2 → f2; brief 2026-11 v1 (…b1); CEO voice v1 (…d1).
create temporary table ids (key text primary key, value uuid);
grant all on ids to public;
create function pg_temp.id(p_key text) returns uuid language sql stable as $$ select value from ids where key = p_key $$;
grant execute on function pg_temp.id(text) to public;

-- Signs in as a user (the role itself is set with "set local role" around each block).
create function pg_temp.as_user(p_sub text, p_aal text default 'aal1') returns void language sql as $$
  select set_config('request.jwt.claims',
    jsonb_build_object('sub', p_sub, 'role', 'authenticated', 'aal', p_aal)::text, true);
$$;
grant execute on function pg_temp.as_user(text, text) to public;

-- One concept per founder, and a draft written for each by the fake runner.
insert into public.concepts (company_id, founder_id, target_month, brief_version_id, title, core_argument, format,
  status, fingerprint)
values
  ('00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-0000000000f1', '2026-11-01',
   '00000000-0000-4000-8000-0000000000b1', 'CEO concept', 'Fleets pay for predictability', 'story', 'selected',
   '{"argument_key": "ceo"}'),
  ('00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-0000000000f2', '2026-11-01',
   '00000000-0000-4000-8000-0000000000b1', 'CTO concept', 'Data beats guesses', 'opinion', 'selected',
   '{"argument_key": "cto"}');
insert into ids select 'concept_a', id from public.concepts where title = 'CEO concept';
insert into ids select 'concept_b', id from public.concepts where title = 'CTO concept';

create function pg_temp.payload(p_body text) returns jsonb language sql as $$
  select jsonb_build_object(
    'body', p_body,
    'alternative_hooks', jsonb_build_array('Hook one', 'Hook two'),
    'rationale', 'Internal reasoning, never for founders',
    'fingerprint', jsonb_build_object('argument_key', 'x'),
    'claims', jsonb_build_array(jsonb_build_object('claim_text', 'Most delays come from approvals', 'claim_kind', 'sourced_fact',
      'span_start', 0, 'span_end', 31, 'approved_fact', null, 'support_status', 'unsupported')),
    'flags', jsonb_build_array(
      jsonb_build_object('kind', 'needs_personal_context', 'severity', 'blocking', 'source', 'placeholder', 'message', 'Founder to supply: a story'),
      jsonb_build_object('kind', 'unsupported_claim', 'severity', 'blocking', 'source', 'claims', 'message', 'Not backed',
        'span_start', 0, 'span_end', 31),
      jsonb_build_object('kind', 'product_claim', 'severity', 'warning', 'source', 'model', 'message', 'Product claim'),
      jsonb_build_object('kind', 'repetition', 'severity', 'warning', 'source', 'repetition', 'message', 'Overlaps (internal)')),
    'checks', '[]'::jsonb);
$$;
grant execute on function pg_temp.payload(text) to public;
-- The same, with no claims or flags (a clean rewrite).
create function pg_temp.clean(p_body text) returns jsonb language sql as $$
  select pg_temp.payload(p_body) || '{"claims": [], "flags": []}'::jsonb;
$$;
grant execute on function pg_temp.clean(text) to public;

create function pg_temp.write_draft(p_founder uuid, p_concept uuid, p_key text) returns uuid language plpgsql as $$
declare
  v_run uuid;
  v_version uuid;
begin
  perform set_config('role', 'authenticated', true);
  perform pg_temp.as_user('00000000-0000-4000-8000-0000000000a1', 'aal2');
  select run_id into v_run from public.request_generation('draft', p_founder, '2026-11-01', 'fake', 'claude-opus-5-5',
    'draft', 1,
    '{"brief_version_id": "00000000-0000-4000-8000-0000000000b1", "voice_profile_version_id": null, "example_ids": []}',
    jsonb_build_object('concept_id', p_concept, 'judge_model', 'claude-sonnet-5-5'), 0.4, p_key);
  perform set_config('role', 'service_role', true);
  perform public.claim_generation_run(v_run);
  v_version := public.complete_draft_run(v_run, 'claude-opus-5-5', '{"cost_usd": 0.05}',
    pg_temp.payload(E'Most delays come from approvals.\n\n[FOUNDER TO SUPPLY: a story]\n\nWhat would you change?'));
  perform set_config('role', 'postgres', true);
  return (select draft_id from public.draft_versions where id = v_version);
end;
$$;

insert into ids select 'draft', pg_temp.write_draft('00000000-0000-4000-8000-0000000000f1', pg_temp.id('concept_a'), 'review-key-0000000a');
insert into ids select 'draft_b', pg_temp.write_draft('00000000-0000-4000-8000-0000000000f2', pg_temp.id('concept_b'), 'review-key-0000000b');
insert into ids select 'v1', current_version_id from public.drafts where id = pg_temp.id('draft');
insert into ids select 'f1_model', id from public.review_flags where draft_version_id = pg_temp.id('v1') and source = 'model';
insert into ids select 'f1_rep', id from public.review_flags where draft_version_id = pg_temp.id('v1') and source = 'repetition';
select is((select status::text from public.drafts where id = pg_temp.id('draft')), 'admin_review', 'setup: a draft in admin review');

-- ===========================================================================
-- Before sharing, the founder sees nothing
-- ===========================================================================
set local role authenticated;
select pg_temp.as_user('00000000-0000-4000-8000-0000000000c1');
select is_empty('select * from public.founder_drafts()', 'a draft in admin review is invisible to its founder');
select is_empty(format('select * from public.founder_draft_versions(%L)', pg_temp.id('draft')), 'and so are its versions');
select throws_ok(format($$select public.approve_draft(%L, %L, '')$$, pg_temp.id('draft'), pg_temp.id('v1')), 'P0002', null,
  'an unshared draft cannot be approved');
select throws_ok(format($$select public.share_draft(%L, '{}')$$, pg_temp.id('draft')), '42501', null,
  'a founder cannot share a draft');
reset role;

-- ===========================================================================
-- Sharing
-- ===========================================================================
-- A founder who has not accepted their invitation cannot be shared with.
update public.profiles set status = 'invited' where user_id = '00000000-0000-4000-8000-0000000000c2';
set local role authenticated;
select pg_temp.as_user('00000000-0000-4000-8000-0000000000a1', 'aal2');
select throws_ok(format($$select public.share_draft(%L, '{}')$$, pg_temp.id('draft_b')), '22023',
  'this founder has not accepted their invitation yet', 'sharing needs an active founder account');
reset role;
update public.profiles set status = 'active' where user_id = '00000000-0000-4000-8000-0000000000c2';

set local role authenticated;
select pg_temp.as_user('00000000-0000-4000-8000-0000000000a1', 'aal2');
select lives_ok(format($$select public.share_draft(%L, array[%L, %L]::uuid[])$$, pg_temp.id('draft'), pg_temp.id('f1_model'), pg_temp.id('f1_rep')),
  'the admin shares the draft, picking a warning and a repetition flag to show');
select lives_ok(format($$select public.share_draft(%L, '{}')$$, pg_temp.id('draft_b')), 'and shares the CTO''s draft');
select throws_ok(format($$select public.share_draft(%L, '{}')$$, pg_temp.id('draft')), '22023', null,
  'a draft already with the founder cannot be shared again');
select throws_ok(format($$select public.transition_draft(%L, 'approved', '')$$, pg_temp.id('draft')), '22023', null,
  'the admin cannot approve by changing the status');
select throws_ok(format($$select public.approve_draft(%L, %L, '')$$, pg_temp.id('draft'), pg_temp.id('v1')), 'P0002', null,
  'the admin cannot approve as the founder');
select lives_ok(format($$select public.add_comment(%L, 'Internal: check the claim', null, 'admin_internal')$$, pg_temp.id('draft')),
  'the admin writes an internal comment');
select lives_ok(format($$select public.add_comment(%L, 'Can you add the story?', '[FOUNDER TO SUPPLY: a story]', 'shared')$$, pg_temp.id('draft')),
  'and a shared one, anchored to a quote');
reset role;
select results_eq(format($$select status::text, shared_with_founder_at is not null from public.drafts where id = %L$$, pg_temp.id('draft')),
  $$values ('founder_review', true)$$, 'the draft is with the founder');
select is((select visible_to_founder from public.review_flags where id = pg_temp.id('f1_rep')), false, 'a repetition flag is never marked shared');

-- ===========================================================================
-- Founder A reads their draft, without internal data
-- ===========================================================================
set local role authenticated;
select pg_temp.as_user('00000000-0000-4000-8000-0000000000c1');
select results_eq('select title, status::text, version_no, approved from public.founder_drafts()',
  $$values ('CEO concept', 'founder_review', 1, false)$$, 'the founder lists their shared draft, and only theirs');
select results_eq(format('select version_no, author_kind::text, is_current, placeholder_count from public.founder_draft_versions(%L)', pg_temp.id('draft')),
  $$values (1, 'ai', true, 1)$$, 'the founder reads the version');
select ok(not exists (select 1 from public.founder_draft_versions(pg_temp.id('draft')) r where to_jsonb(r) ? 'rationale'),
  'the rationale is never returned to the founder');
select ok(not exists (select 1 from public.founder_draft_versions(pg_temp.id('draft')) r where r.body like '%Internal reasoning%'),
  'nor does it leak into the body');
select results_eq(format('select kind::text, severity::text, quote from public.founder_draft_flags(%L) order by kind::text', pg_temp.id('draft')),
  $$values ('needs_personal_context', 'blocking', null::text), ('product_claim', 'warning', null::text), ('unsupported_claim', 'blocking', 'Most delays come from approvals')$$,
  'the founder sees the shared warning and every open blocking flag, never a repetition flag (it quotes other drafts)');
select results_eq(format('select body, quote, author_role::text from public.founder_comments(%L)', pg_temp.id('draft')),
  $$values ('Can you add the story?', '[FOUNDER TO SUPPLY: a story]', 'admin')$$, 'the founder sees shared comments only');
select throws_ok(format($$select public.add_comment(%L, 'secret', null, 'admin_internal')$$, pg_temp.id('draft')), '42501', null,
  'a founder cannot write an internal comment');
select lives_ok(format($$select public.add_comment(%L, 'Will do', 'a story', 'shared')$$, pg_temp.id('draft')),
  'the founder replies with a shared comment');
select is_empty('select 1 from public.drafts', 'the founder still cannot read the drafts table');
select is_empty('select 1 from public.draft_versions', 'nor versions directly (with the rationale)');
select is_empty('select 1 from public.review_flags', 'nor all flags');
select is_empty('select 1 from public.approvals', 'nor approvals');
select is_empty('select 1 from public.comments', 'nor the comments table');
select is_empty('select 1 from public.rewrite_requests', 'nor rewrite requests');
select throws_ok($$insert into public.approvals (company_id, draft_id, draft_version_id, body_hash, approver_user_id, approver_role, decision)
  values ('00000000-0000-4000-8000-000000000001', pg_temp.id('draft'), pg_temp.id('v1'), '\x00', '00000000-0000-4000-8000-0000000000c1', 'founder', 'approved')$$,
  '42501', null, 'a founder cannot insert an approval directly');
select throws_ok(format($$update public.drafts set status = 'approved' where id = %L$$, pg_temp.id('draft')), '42501', null,
  'nor set the status directly');
select throws_ok(format($$select public.transition_draft(%L, 'approved', '')$$, pg_temp.id('draft')), '42501', null,
  'nor use the admin''s state machine');
-- The founder cannot reach another founder's draft by id.
select is_empty(format('select * from public.founder_draft_versions(%L)', pg_temp.id('draft_b')), 'founder A cannot read B''s versions');
select is_empty(format('select * from public.founder_draft_flags(%L)', pg_temp.id('draft_b')), 'nor B''s flags');
select is_empty(format('select * from public.founder_comments(%L)', pg_temp.id('draft_b')), 'nor B''s comments');
select throws_ok(format($$select public.add_comment(%L, 'hi', null, 'shared')$$, pg_temp.id('draft_b')), 'P0002', null, 'nor comment on it');
select throws_ok(format($$select public.founder_save_version(%L, 'mine now', '')$$, pg_temp.id('draft_b')), 'P0002', null, 'nor edit it');
select throws_ok(format($$select public.request_rewrite(%L, 'shorter', 'k')$$, pg_temp.id('draft_b')), 'P0002', null, 'nor rewrite it');
select throws_ok(format($$select public.request_changes(%L, '')$$, pg_temp.id('draft_b')), 'P0002', null, 'nor return it');
select throws_ok(format($$select public.founder_reject_draft(%L, '')$$, pg_temp.id('draft_b')), 'P0002', null, 'nor reject it');
reset role;

set local role authenticated;
select pg_temp.as_user('00000000-0000-4000-8000-0000000000c2');
select results_eq('select title from public.founder_drafts()', $$values ('CTO concept')$$, 'founder B lists only their own draft');
select is_empty(format('select * from public.founder_comments(%L)', pg_temp.id('draft')), 'founder B cannot read A''s comments');
select throws_ok(format($$select public.approve_draft(%L, %L, '')$$, pg_temp.id('draft'), pg_temp.id('v1')), 'P0002', null,
  'founder B cannot approve A''s draft');
reset role;

set local role anon;
select set_config('request.jwt.claims', '{"role":"anon"}', true);
select throws_ok('select * from public.approvals', '42501', null, 'anon cannot read approvals');
select throws_ok('select * from public.comments', '42501', null, 'anon cannot read comments');
select throws_ok('select * from public.rewrite_requests', '42501', null, 'anon cannot read rewrite requests');
select throws_ok('select * from public.founder_drafts()', '42501', null, 'anon cannot call the founder functions');
reset role;

set local role authenticated;
select pg_temp.as_user('00000000-0000-4000-8000-0000000000a1', 'aal2');
select is((select count(*)::int from public.comments where draft_id = pg_temp.id('draft')), 3, 'the admin reads every comment');
select throws_ok(format($$select public.set_run_input_refs(%L, '{}')$$, pg_temp.id('draft')), '42501', null,
  'only the runner records run inputs');
select throws_ok(format($$select public.complete_feedback_run(%L, 'm', '{}', '[]')$$, pg_temp.id('draft')), '42501', null,
  'only the runner stores feedback signals');
reset role;

-- ===========================================================================
-- Approval is blocked by placeholders and blocking flags
-- ===========================================================================
set local role authenticated;
select pg_temp.as_user('00000000-0000-4000-8000-0000000000c1');
select throws_ok(format($$select public.approve_draft(%L, %L, '')$$, pg_temp.id('draft'), pg_temp.id('v1')), '22023',
  'replace every [FOUNDER TO SUPPLY] placeholder first', 'a placeholder blocks approval');
select is(public.founder_save_version(pg_temp.id('draft'),
  E'Most delays come from approvals.\n\nLast spring a van sat ready for two days.\n\nWhat would you change?', 'My story'), 2,
  'the founder edits the text: version 2');
reset role;
insert into ids select 'v2', current_version_id from public.drafts where id = pg_temp.id('draft');
select results_eq(format($$select author_kind::text, created_by::text, placeholder_count, rationale from public.draft_versions where id = %L$$, pg_temp.id('v2')),
  $$values ('founder', '00000000-0000-4000-8000-0000000000c1', 0, 'Internal reasoning, never for founders')$$,
  'version 2 is the founder''s; the internal rationale stays with the draft');
select results_eq(format($$select source, status::text, visible_to_founder, span_start from public.review_flags where draft_version_id = %L order by source$$, pg_temp.id('v2')),
  $$values ('claims', 'open', false, 0), ('model', 'open', true, null::int), ('repetition', 'open', false, null::int)$$,
  'the placeholder flag clears; the claim flag follows its text; shared flags stay shared');
select is((select count(*)::int from public.draft_claims where draft_version_id = pg_temp.id('v2')), 1, 'the claim carries over');
select is((select count(*)::int from public.draft_versions where draft_id = pg_temp.id('draft')), 2, 'version 1 is kept');

set local role authenticated;
select pg_temp.as_user('00000000-0000-4000-8000-0000000000c1');
select throws_ok(format($$select public.approve_draft(%L, %L, '')$$, pg_temp.id('draft'), pg_temp.id('v2')), '22023',
  'a blocking flag is still open', 'an open blocking flag blocks approval');
reset role;

set local role authenticated;
select pg_temp.as_user('00000000-0000-4000-8000-0000000000a1', 'aal2');
select lives_ok(format($$select public.resolve_review_flag((select id from public.review_flags where draft_version_id = %L and source = 'claims'), 'resolve', 'Confirmed with ops data')$$,
  pg_temp.id('v2')), 'the admin resolves the claim with a reason');
reset role;

-- ===========================================================================
-- Approval binds to the exact version
-- ===========================================================================
set local role authenticated;
select pg_temp.as_user('00000000-0000-4000-8000-0000000000c1');
select throws_ok(format($$select public.approve_draft(%L, %L, '')$$, pg_temp.id('draft'), pg_temp.id('v1')), '40001', null,
  'approving a version that is no longer current is refused (concurrent edit)');
insert into ids select 'approval1', public.approve_draft(pg_temp.id('draft'), pg_temp.id('v2'), 'Good to go');
select results_eq('select status::text, approved from public.founder_drafts()', $$values ('approved', true)$$,
  'the founder sees it approved');
reset role;
select results_eq(format($$select a.approver_user_id::text, a.approver_role::text, a.draft_version_id = %L, a.body_hash = v.body_normalized_hash,
    a.created_at is not null, a.note, a.invalidated_at is null
    from public.approvals a join public.draft_versions v on v.id = a.draft_version_id where a.id = %L$$, pg_temp.id('v2'), pg_temp.id('approval1')),
  $$values ('00000000-0000-4000-8000-0000000000c1', 'founder', true, true, true, 'Good to go', true)$$,
  'the approval records who, which version, its hash and when');
select is((private.valid_approval(pg_temp.id('draft'))).id, pg_temp.id('approval1'), 'it is the valid approval');
select is((select status::text from public.drafts where id = pg_temp.id('draft')), 'approved', 'the draft is approved');
select results_eq(format($$select status::text, estimated_cost_usd, params ->> 'before_version_id', params ->> 'version_id', model
    from public.generation_runs where kind = 'feedback_classification' and params ->> 'draft_id' = %L$$, pg_temp.id('draft')),
  format($$values ('queued', 0.10::numeric, %L, %L, 'claude-sonnet-5-5')$$, pg_temp.id('v1'), pg_temp.id('v2')),
  'the founder''s edits queue a feedback proposal, comparing the AI version with the approved one');
select is((select count(*)::int from public.audit_events where action = 'draft.approved' and entity_id = pg_temp.id('draft')), 1, 'approval is audited');

-- Insert-only.
select throws_ok(format($$update public.approvals set note = 'changed' where id = %L$$, pg_temp.id('approval1')), '42501', null,
  'an approval cannot be changed');
select throws_ok(format($$update public.approvals set body_hash = '\x00', invalidated_at = now() where id = %L$$, pg_temp.id('approval1')), '42501', null,
  'invalidating cannot change anything else');
select throws_ok(format($$delete from public.approvals where id = %L$$, pg_temp.id('approval1')), '42501', null,
  'an approval cannot be deleted');

-- ===========================================================================
-- Material-edit rule
-- ===========================================================================
set local role authenticated;
select pg_temp.as_user('00000000-0000-4000-8000-0000000000a1', 'aal2');
select is(public.save_draft_version(pg_temp.id('draft'),
  E'\r\nMost delays come from approvals.  \r\n\r\nLast spring a van sat ready for two days.\t\r\n\r\nWhat would you change?\r\n\r\n',
  array['Hook one', 'Hook two'], null, 'whitespace',
  '[{"claim_text": "Most delays come from approvals", "claim_kind": "sourced_fact", "span_start": 2, "span_end": 33, "support_status": "unsupported"}]',
  '[{"kind": "unsupported_claim", "severity": "blocking", "source": "claims", "message": "Not backed", "span_start": 2, "span_end": 33}]'),
  3, 'a whitespace-only admin edit is version 3');
reset role;
select results_eq(format($$select status::text, resolution_note from public.review_flags where draft_version_id = (select current_version_id from public.drafts where id = %L) and source = 'claims'$$, pg_temp.id('draft')),
  $$values ('resolved', 'Confirmed with ops data')$$, 'a claim flag raised again by the admin''s edit keeps its resolution');
select results_eq(format($$select d.status::text, (private.valid_approval(d.id)).id = %L from public.drafts d where d.id = %L$$,
    pg_temp.id('approval1'), pg_temp.id('draft')),
  $$values ('approved', true)$$, 'a whitespace-only edit keeps the approval');

set local role authenticated;
select pg_temp.as_user('00000000-0000-4000-8000-0000000000a1', 'aal2');
select is(public.save_draft_version(pg_temp.id('draft'),
  E'Most delays come from approvals.\n\nLast spring a van sat ready for three days.\n\nWhat would you change?',
  array['Hook one', 'Hook two'], null, 'one word', '[]', '[]'), 4, 'the admin changes one word: version 4');
reset role;
insert into ids select 'v4', current_version_id from public.drafts where id = pg_temp.id('draft');
select results_eq(format($$select invalidated_at is not null, invalidated_reason, invalidated_by_version_id = %L from public.approvals where id = %L$$,
    pg_temp.id('v4'), pg_temp.id('approval1')),
  $$values (true, 'material edit', true)$$, 'a one-word edit invalidates the approval, naming the new version');
select results_eq(format($$select status::text, private.valid_approval(id) is null from public.drafts where id = %L$$, pg_temp.id('draft')),
  $$values ('admin_review', true)$$, 'and returns the draft to admin review (the admin made the edit)');
select is((select count(*)::int from public.audit_events where action = 'approval.invalidated' and entity_id = pg_temp.id('draft')), 1,
  'the invalidation is audited');

-- Shared again; approved again; then the selected opening line changes.
set local role authenticated;
select pg_temp.as_user('00000000-0000-4000-8000-0000000000a1', 'aal2');
select lives_ok(format($$select public.share_draft(%L, '{}')$$, pg_temp.id('draft')), 'shared again');
reset role;
set local role authenticated;
select pg_temp.as_user('00000000-0000-4000-8000-0000000000c1');
insert into ids select 'approval2', public.approve_draft(pg_temp.id('draft'), pg_temp.id('v4'), '');
reset role;
set local role authenticated;
select pg_temp.as_user('00000000-0000-4000-8000-0000000000a1', 'aal2');
select is(public.save_draft_version(pg_temp.id('draft'),
  E'Most delays come from approvals.\n\nLast spring a van sat ready for three days.\n\nWhat would you change?',
  array['Hook one', 'Hook two', 'Hook three'], null, 'another suggestion', '[]', '[]'), 5, 'adding an alternative line: version 5');
reset role;
select is((select status::text from public.drafts where id = pg_temp.id('draft')), 'approved',
  'an unselected alternative opening line is not material');
set local role authenticated;
select pg_temp.as_user('00000000-0000-4000-8000-0000000000a1', 'aal2');
select is(public.save_draft_version(pg_temp.id('draft'),
  E'Most delays come from approvals.\n\nLast spring a van sat ready for three days.\n\nWhat would you change?',
  array['Hook one', 'Hook two', 'Hook three'], 1::smallint, 'chose hook two', '[]', '[]'), 6, 'selecting an opening line: version 6');
reset role;
select results_eq(format($$select d.status::text, a.invalidated_reason from public.drafts d join public.approvals a on a.id = %L where d.id = %L$$,
    pg_temp.id('approval2'), pg_temp.id('draft')),
  $$values ('admin_review', 'material edit')$$, 'choosing a different opening line is material');

-- A founder's material edit to their approved draft returns it to founder review.
set local role authenticated;
select pg_temp.as_user('00000000-0000-4000-8000-0000000000a1', 'aal2');
select lives_ok(format($$select public.share_draft(%L, '{}')$$, pg_temp.id('draft')), 'shared again');
reset role;
set local role authenticated;
select pg_temp.as_user('00000000-0000-4000-8000-0000000000c1');
insert into ids select 'v6', (select id from public.founder_draft_versions(pg_temp.id('draft')) where is_current);
insert into ids select 'approval3', public.approve_draft(pg_temp.id('draft'), pg_temp.id('v6'), '');
select is(public.founder_save_version(pg_temp.id('draft'),
  E'Most delays come from approvals.\n\nLast spring a van sat ready for three days!\n\nWhat would you change?', ''), 7,
  'the founder edits their approved draft: version 7');
select results_eq('select status::text, approved from public.founder_drafts()', $$values ('founder_review', false)$$,
  'their approval is withdrawn and the draft is back in front of them');
reset role;
select results_eq(format($$select selected_hook_index::int, alternative_hooks from public.draft_versions where id = (select current_version_id from public.drafts where id = %L)$$, pg_temp.id('draft')),
  $$values (1, array['Hook one', 'Hook two', 'Hook three'])$$, 'a founder edit keeps the chosen opening line');

-- ===========================================================================
-- Revoking, requesting changes
-- ===========================================================================
set local role authenticated;
select pg_temp.as_user('00000000-0000-4000-8000-0000000000c1');
insert into ids select 'v7', (select id from public.founder_draft_versions(pg_temp.id('draft')) where is_current);
insert into ids select 'approval4', public.approve_draft(pg_temp.id('draft'), pg_temp.id('v7'), '');
select lives_ok(format($$select public.revoke_approval(%L, 'Want to think')$$, pg_temp.id('draft')), 'the founder revokes their approval');
select results_eq('select status::text, approved from public.founder_drafts()', $$values ('founder_review', false)$$, 'back to founder review');
select lives_ok(format($$select public.request_changes(%L, 'Make it shorter')$$, pg_temp.id('draft')), 'the founder asks for changes');
select results_eq('select status::text from public.founder_drafts()', $$values ('changes_requested')$$, 'changes requested');
select throws_ok(format($$select public.approve_draft(%L, %L, '')$$, pg_temp.id('draft'), pg_temp.id('v7')), '22023', null,
  'a draft with changes requested cannot be approved until it is back in review');
reset role;
select is((select invalidated_reason from public.approvals where id = pg_temp.id('approval4')), 'revoked by the founder: Want to think',
  'the revocation is recorded on the approval');
select ok(exists (select 1 from public.comments where draft_id = pg_temp.id('draft') and body = 'Make it shorter' and visibility = 'shared'),
  'the request for changes is a shared comment');

-- ===========================================================================
-- Rewrites
-- ===========================================================================
update public.settings set ai_monthly_budget_usd = 0.05 where company_id = '00000000-0000-4000-8000-000000000001';
set local role authenticated;
select pg_temp.as_user('00000000-0000-4000-8000-0000000000c1');
select results_eq(format($$select run_status::text, message is not null from public.request_rewrite(%L, 'Shorter', 'refused-1')$$, pg_temp.id('draft')),
  $$values ('refused', true)$$, 'a rewrite over the monthly budget is refused before any call');
reset role;
select is((select status::text from public.rewrite_requests where instructions = 'Shorter' and draft_id = pg_temp.id('draft')), 'failed',
  'the refused request is marked failed');
update public.settings set ai_monthly_budget_usd = 10 where company_id = '00000000-0000-4000-8000-000000000001';

set local role authenticated;
select pg_temp.as_user('00000000-0000-4000-8000-0000000000c1');
insert into ids select 'rewrite_run', run_id from public.request_rewrite(pg_temp.id('draft'), 'Open with the van', 'rewrite-1');
select is((select run_id from public.request_rewrite(pg_temp.id('draft'), 'Open with the van', 'rewrite-1')), pg_temp.id('rewrite_run'),
  'asking twice with the same key is one run');
select results_eq(format('select instructions, status::text from public.founder_rewrite_requests(%L) order by instructions', pg_temp.id('draft')),
  $$values ('Open with the van', 'requested'), ('Shorter', 'failed')$$, 'the founder sees their requests');
reset role;
select results_eq(format($$select kind::text, status::text, estimated_cost_usd, model, requested_by::text, params ->> 'guidance'
    from public.generation_runs where id = %L$$, pg_temp.id('rewrite_run')),
  $$values ('rewrite', 'queued', 2.00::numeric, 'claude-opus-5-5', '00000000-0000-4000-8000-0000000000c1', 'Open with the van')$$,
  'the rewrite run reserves the full per-run ceiling and uses the draft''s model');

set local role service_role;
select is((select id from public.claim_generation_run(pg_temp.id('rewrite_run'))), pg_temp.id('rewrite_run'), 'the runner claims the rewrite');
select lives_ok(format($$select public.set_run_input_refs(%L, '{"brief_version_id": "00000000-0000-4000-8000-0000000000b1", "voice_profile_version_id": null, "example_ids": []}')$$,
  pg_temp.id('rewrite_run')), 'and records the inputs it chose');
insert into ids select 'v8', public.complete_draft_run(pg_temp.id('rewrite_run'), 'claude-opus-5-5', '{"cost_usd": 0.06}',
  pg_temp.clean(E'A van sat ready for three days.\n\nMost delays come from approvals.'));
reset role;
select results_eq(format($$select d.status::text, v.version_no, v.author_kind::text, r.status::text, r.resulting_version_id = v.id
    from public.drafts d join public.draft_versions v on v.id = d.current_version_id
    join public.rewrite_requests r on r.generation_run_id = %L where d.id = %L$$, pg_temp.id('rewrite_run'), pg_temp.id('draft')),
  $$values ('founder_review', 8, 'ai', 'completed', true)$$, 'the rewrite is a new version in front of the founder');
select is((select count(*)::int from public.draft_versions where draft_id = pg_temp.id('draft')), 8, 'every earlier version is kept');
select is((select input_refs ->> 'brief_version_id' from public.generation_runs where id = pg_temp.id('rewrite_run')),
  '00000000-0000-4000-8000-0000000000b1', 'the run records what it was based on');

-- A rewrite of an approved draft invalidates the approval when it lands.
set local role authenticated;
select pg_temp.as_user('00000000-0000-4000-8000-0000000000c1');
insert into ids select 'approval5', public.approve_draft(pg_temp.id('draft'), pg_temp.id('v8'), '');
insert into ids select 'rewrite_run2', run_id from public.request_rewrite(pg_temp.id('draft'), 'Even shorter', 'rewrite-2');
reset role;
set local role service_role;
select lives_ok(format('select public.claim_generation_run(%L)', pg_temp.id('rewrite_run2')), 'claim');
select lives_ok(format($$select public.complete_draft_run(%L, 'm', '{}', pg_temp.clean('A van sat ready.'))$$, pg_temp.id('rewrite_run2')),
  'the second rewrite lands');
reset role;
select results_eq(format($$select d.status::text, a.invalidated_reason from public.drafts d join public.approvals a on a.id = %L where d.id = %L$$,
    pg_temp.id('approval5'), pg_temp.id('draft')),
  $$values ('founder_review', 'material edit')$$, 'a rewrite of an approved draft withdraws the approval');

-- A failed rewrite marks its request failed.
set local role authenticated;
select pg_temp.as_user('00000000-0000-4000-8000-0000000000c1');
insert into ids select 'rewrite_run3', run_id from public.request_rewrite(pg_temp.id('draft'), 'Fails', 'rewrite-3');
reset role;
set local role service_role;
select lives_ok(format('select public.claim_generation_run(%L)', pg_temp.id('rewrite_run3')), 'claim');
select lives_ok(format($$select public.fail_generation_run(%L, 'bad_request', 'The AI service rejected the request.', null, '{}')$$,
  pg_temp.id('rewrite_run3')), 'the run fails');
reset role;
select is((select status::text from public.rewrite_requests where generation_run_id = pg_temp.id('rewrite_run3')), 'failed',
  'its request is marked failed');

-- At most 10 a day.
insert into public.rewrite_requests (company_id, draft_id, requested_by, instructions, status)
select '00000000-0000-4000-8000-000000000001', pg_temp.id('draft'), '00000000-0000-4000-8000-0000000000c1', 'filler ' || n, 'completed'
from generate_series(1, 10 - (select count(*)::int from public.rewrite_requests where draft_id = pg_temp.id('draft'))) n;
set local role authenticated;
select pg_temp.as_user('00000000-0000-4000-8000-0000000000c1');
select throws_ok(format($$select public.request_rewrite(%L, 'One more', 'rewrite-11')$$, pg_temp.id('draft')), '22023',
  'you can request up to 10 rewrites a day', 'the eleventh rewrite in a day is refused');
reset role;

-- ===========================================================================
-- Feedback proposals from the founder's edits
-- ===========================================================================
insert into ids select 'feedback_run', id from public.generation_runs
  where kind = 'feedback_classification' and params ->> 'version_id' = pg_temp.id('v2')::text;
set local role service_role;
select lives_ok(format('select public.claim_generation_run(%L)', pg_temp.id('feedback_run')), 'the runner claims the feedback run');
select is(public.complete_feedback_run(pg_temp.id('feedback_run'), 'claude-sonnet-5-5', '{"cost_usd": 0.004}',
  '[{"kind": "stable_preference", "statement": "Replaces placeholders with a concrete story.", "format": null},
    {"kind": "format_preference", "statement": "No format given", "format": null},
    {"kind": "one_off", "statement": "  ", "format": null}]'), 1, 'only well-formed signals are stored');
reset role;
select results_eq(format($$select founder_id::text, kind::text, proposed_by::text, status::text, draft_version_id = %L
    from public.feedback_signals where statement = 'Replaces placeholders with a concrete story.'$$, pg_temp.id('v2')),
  $$values ('00000000-0000-4000-8000-0000000000f1', 'stable_preference', 'system', 'proposed', true)$$,
  'the signal is a proposal for the admin, against the approved version');
select is((select status::text from public.generation_runs where id = pg_temp.id('feedback_run')), 'succeeded', 'the run succeeded');
select results_eq(format($$select v.version_no from public.generation_runs r join public.draft_versions v on v.id = (r.params ->> 'version_id')::uuid
    where r.kind = 'feedback_classification' and r.params ->> 'draft_id' = %L order by v.version_no$$, pg_temp.id('draft')),
  $$values (2), (7)$$, 'one proposal per round of founder edits: re-approving without new edits proposes nothing');

-- ===========================================================================
-- Admin withdrawal, founder rejection
-- ===========================================================================
set local role authenticated;
select pg_temp.as_user('00000000-0000-4000-8000-0000000000c2');
insert into ids select 'b_v1', (select id from public.founder_draft_versions(pg_temp.id('draft_b')) where is_current);
reset role;
-- Clear B's blocking flags for this scenario (test data only).
update public.review_flags set status = 'resolved', resolved_at = now(), resolution_note = 'test setup'
where draft_version_id = pg_temp.id('b_v1') and severity = 'blocking';
set local role authenticated;
select pg_temp.as_user('00000000-0000-4000-8000-0000000000c2');
select throws_ok(format($$select public.approve_draft(%L, %L, '')$$, pg_temp.id('draft_b'), pg_temp.id('b_v1')), '22023',
  'replace every [FOUNDER TO SUPPLY] placeholder first', 'resolving the placeholder''s flag is not enough: the text must change');
select is(public.founder_save_version(pg_temp.id('draft_b'), 'Data beats guesses, every time.', ''), 2, 'B rewrites it');
insert into ids select 'b_approval', public.approve_draft(pg_temp.id('draft_b'),
  (select id from public.founder_draft_versions(pg_temp.id('draft_b')) where is_current), '');
reset role;
set local role authenticated;
select pg_temp.as_user('00000000-0000-4000-8000-0000000000a1', 'aal2');
select lives_ok(format($$select public.transition_draft(%L, 'admin_review', 'Needs a date check')$$, pg_temp.id('draft_b')),
  'the admin can pull an approved draft back');
reset role;
select results_eq(format($$select d.status::text, a.invalidated_reason from public.drafts d join public.approvals a on a.id = %L where d.id = %L$$,
    pg_temp.id('b_approval'), pg_temp.id('draft_b')),
  $$values ('admin_review', 'withdrawn by the admin')$$, 'which withdraws the approval');
set local role authenticated;
select pg_temp.as_user('00000000-0000-4000-8000-0000000000c2');
select is_empty('select * from public.founder_drafts()', 'a draft back in admin review leaves the founder''s list');
reset role;

set local role authenticated;
select pg_temp.as_user('00000000-0000-4000-8000-0000000000c1');
select lives_ok(format($$select public.founder_reject_draft(%L, 'Not for me')$$, pg_temp.id('draft')), 'the founder rejects their draft');
select is_empty('select * from public.founder_drafts()', 'a rejected draft leaves the founder''s list');
reset role;
select results_eq(format($$select decision::text, note, approver_role::text from public.approvals where draft_id = %L and decision = 'rejected'$$, pg_temp.id('draft')),
  $$values ('rejected', 'Not for me', 'founder')$$, 'the rejection is recorded with the version it was about');
select is((select status::text from public.drafts where id = pg_temp.id('draft')), 'rejected', 'the draft is rejected');

select * from finish();
rollback;
