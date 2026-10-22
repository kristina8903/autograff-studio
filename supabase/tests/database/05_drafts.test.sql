-- Phase 4b tests: drafts, versions, claims, flags, repetition, the draft state machine.

begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

-- Seed: admin a1; CEO c1 → f1; brief 2026-11 v1 (…b1); CEO voice v1 (…d1).
create temporary table ids (key text primary key, value uuid);
grant all on ids to public;

-- A selected concept to draft from.
insert into public.concepts (company_id, founder_id, target_month, brief_version_id, title, core_argument, format,
  status, fingerprint)
values ('00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-0000000000f1', '2026-11-01',
  '00000000-0000-4000-8000-0000000000b1', 'Status updates are a product', 'Fleets pay for predictability', 'story',
  'selected', '{"argument_key": "status updates are a product"}');
insert into ids select 'concept', id from public.concepts where title = 'Status updates are a product';

create function pg_temp.request(p_kind public.generation_kind, p_params jsonb, p_key text) returns uuid language sql as $$
  select run_id from public.request_generation(p_kind, '00000000-0000-4000-8000-0000000000f1', '2026-11-01', 'fake',
    'claude-opus-5-5', 'draft', 1,
    '{"brief_version_id": "00000000-0000-4000-8000-0000000000b1", "voice_profile_version_id": "00000000-0000-4000-8000-0000000000d1", "example_ids": []}',
    p_params, 0.4, p_key);
$$;
grant execute on function pg_temp.request(public.generation_kind, jsonb, text) to public;

create function pg_temp.payload(p_body text) returns jsonb language sql as $$
  select jsonb_build_object(
    'body', p_body,
    'alternative_hooks', jsonb_build_array('Hook one', 'Hook two'),
    'rationale', 'Internal reasoning',
    'fingerprint', jsonb_build_object('argument_key', 'status updates are a product'),
    'claims', jsonb_build_array(jsonb_build_object('claim_text', 'Most delays come from approvals', 'claim_kind', 'sourced_fact',
      'span_start', 0, 'span_end', 31, 'approved_fact', null, 'support_status', 'unsupported')),
    'flags', jsonb_build_array(
      jsonb_build_object('kind', 'needs_personal_context', 'severity', 'blocking', 'source', 'placeholder', 'message', 'Founder to supply: a story'),
      jsonb_build_object('kind', 'unsupported_claim', 'severity', 'blocking', 'source', 'claims', 'message', 'Not backed'),
      jsonb_build_object('kind', 'product_claim', 'severity', 'warning', 'source', 'model', 'message', 'Product claim'),
      jsonb_build_object('kind', 'repetition', 'severity', 'warning', 'source', 'repetition', 'message', 'Overlaps',
        'compared_type', 'concept', 'compared_id', '00000000-0000-4000-8000-0000000000aa')),
    'checks', jsonb_build_array(jsonb_build_object('compared_type', 'concept', 'compared_id', '00000000-0000-4000-8000-0000000000aa',
      'method', 'llm', 'score', 0.5, 'explanation', 'Same argument')));
$$;
grant execute on function pg_temp.payload(text) to public;

-- ===========================================================================
-- Normalization (PRODUCT_SPEC §7.4)
-- ===========================================================================
select is(private.normalize_body(E'\n\nFirst line  \r\nSecond\t\r\n\r\nThird\n\n'), E'First line\nSecond\n\nThird',
  'normalization: line endings, trailing spaces and tabs, outer blank lines');
select is(private.normalize_body(E'café'), E'café', 'normalization: Unicode NFC');
select isnt(private.normalize_body('a  b'), private.normalize_body('a b'), 'inner spacing is material');

-- ===========================================================================
-- Generating a draft (runner, service_role)
-- ===========================================================================
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000a1","role":"authenticated","aal":"aal2"}', true);
insert into ids select 'run1', pg_temp.request('draft', jsonb_build_object('concept_id', (select value from ids where key = 'concept')), 'draft-key-000000000001');
reset role;

set local role service_role;
select is((select id from public.claim_generation_run()), (select value from ids where key = 'run1'), 'claim the draft run');
insert into ids select 'v1', public.complete_draft_run((select value from ids where key = 'run1'), 'claude-opus-5-5',
  '{"input_tokens": 5000, "output_tokens": 1200, "cost_usd": 0.044}',
  pg_temp.payload(E'Most delays come from approvals.\n\n[FOUNDER TO SUPPLY: a story]\n\nWhat would you change?'));
reset role;
insert into ids select 'draft', draft_id from public.draft_versions where id = (select value from ids where key = 'v1');

select results_eq($$select d.status::text, d.current_version_id = (select value from ids where key = 'v1'), d.brief_version_id::text, d.concept_id = (select value from ids where key = 'concept')
    from public.drafts d where d.id = (select value from ids where key = 'draft')$$,
  $$values ('admin_review', true, '00000000-0000-4000-8000-0000000000b1', true)$$,
  'a new draft is in admin review, from its concept and brief version');
select results_eq($$select version_no, author_kind::text, placeholder_count, body_normalized_hash = sha256(convert_to(private.normalize_body(body), 'UTF8')),
    voice_profile_version_id::text, rationale from public.draft_versions where id = (select value from ids where key = 'v1')$$,
  $$values (1, 'ai', 1, true, '00000000-0000-4000-8000-0000000000d1', 'Internal reasoning')$$,
  'version 1 is the AI''s, with its hash, placeholder count and voice version');
select is((select status::text from public.concepts where id = (select value from ids where key = 'concept')), 'drafted',
  'the concept is marked drafted');
select is((select count(*)::int from public.review_flags where draft_version_id = (select value from ids where key = 'v1')), 4,
  'the flags are stored with the version');
select is((select count(*)::int from public.draft_claims where draft_version_id = (select value from ids where key = 'v1')), 1, 'claims stored');
select is((select count(*)::int from public.repetition_checks where subject_id = (select value from ids where key = 'v1')), 1, 'repetition checks stored');
select results_eq($$select status::text, actual_cost_usd from public.generation_runs where id = (select value from ids where key = 'run1')$$,
  $$values ('succeeded', 0.044::numeric)$$, 'the run succeeded with its cost');

select throws_ok($$update public.draft_versions set body = 'changed'$$, null, null, 'versions are immutable, even for the owner');
select throws_ok($$delete from public.draft_versions$$, null, null, 'versions cannot be deleted');
select throws_ok($$insert into public.review_flags (draft_version_id, company_id, kind, severity, source, message, status, resolved_at, resolution_note)
  values ((select value from ids where key = 'v1'), '00000000-0000-4000-8000-000000000001', 'style', 'warning', 'lint', 'x', 'overridden', now(), 'no')$$,
  '23514', null, 'an override must record a reason');

-- A concept that is not selected cannot be drafted.
update public.concepts set status = 'rejected' where id = (select value from ids where key = 'concept');
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000a1","role":"authenticated","aal":"aal2"}', true);
insert into ids select 'run_bad', pg_temp.request('draft', jsonb_build_object('concept_id', (select value from ids where key = 'concept')), 'draft-key-000000000002');
reset role;
set local role service_role;
select lives_ok('select * from public.claim_generation_run()', 'claim');
select throws_ok(format($$select public.complete_draft_run(%L, 'm', '{}', pg_temp.payload('x'))$$, (select value from ids where key = 'run_bad')),
  '22023', null, 'a draft is only written from a selected concept');
reset role;
update public.concepts set status = 'drafted' where id = (select value from ids where key = 'concept');

-- ===========================================================================
-- Access
-- ===========================================================================
set local role anon;
select set_config('request.jwt.claims', '{"role":"anon"}', true);
select throws_ok('select * from public.drafts', '42501', null, 'anon cannot read drafts');
select throws_ok('select * from public.draft_versions', '42501', null, 'anon cannot read versions');
select throws_ok('select * from public.review_flags', '42501', null, 'anon cannot read flags');
reset role;

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000c1","role":"authenticated","aal":"aal2"}', true);
select is_empty('select 1 from public.drafts', 'a founder sees no drafts until founder review exists (Phase 7)');
select is_empty('select 1 from public.draft_versions', 'nor their versions');
select is_empty('select 1 from public.draft_claims', 'nor claims');
select is_empty('select 1 from public.review_flags', 'nor flags');
select is_empty('select 1 from public.repetition_checks', 'nor repetition checks');
select throws_ok(format($$select public.save_draft_version(%L, 'mine', '{}', null, '', '[]', '[]')$$, (select value from ids where key = 'draft')),
  '42501', null, 'a founder cannot write versions yet');
select throws_ok(format($$select public.transition_draft(%L, 'rejected', '')$$, (select value from ids where key = 'draft')),
  '42501', null, 'a founder cannot change draft status');
select throws_ok($$select * from public.repetition_candidates('00000000-0000-4000-8000-000000000001', 'x', 'k', '2026-11-01', null, null)$$,
  '42501', null, 'a founder cannot run the repetition check');
reset role;

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000a1","role":"authenticated","aal":"aal1"}', true);
select is_empty('select 1 from public.drafts', 'admin without MFA sees no drafts');
reset role;

-- ===========================================================================
-- Regeneration: a new version, nothing overwritten
-- ===========================================================================
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000a1","role":"authenticated","aal":"aal2"}', true);
insert into ids select 'run2', pg_temp.request('draft_regen', jsonb_build_object('draft_id', (select value from ids where key = 'draft'),
  'concept_id', (select value from ids where key = 'concept'), 'guidance', 'Shorter'), 'draft-key-000000000003');
reset role;
set local role service_role;
select is((select id from public.claim_generation_run()), (select value from ids where key = 'run2'), 'claim the regeneration');
insert into ids select 'v2', public.complete_draft_run((select value from ids where key = 'run2'), 'claude-opus-5-5', '{}',
  pg_temp.payload('A shorter version.'));
reset role;
select results_eq($$select version_no, parent_version_id = (select value from ids where key = 'v1'), change_note, placeholder_count
    from public.draft_versions where id = (select value from ids where key = 'v2')$$,
  $$values (2, true, 'Shorter', 0)$$, 'the regeneration is version 2, linked to version 1');
select is((select current_version_id from public.drafts where id = (select value from ids where key = 'draft')),
  (select value from ids where key = 'v2'), 'version 2 is current');
select is((select count(*)::int from public.drafts), 1, 'regenerating did not create another draft');
select is((select body from public.draft_versions where id = (select value from ids where key = 'v1')),
  E'Most delays come from approvals.\n\n[FOUNDER TO SUPPLY: a story]\n\nWhat would you change?', 'version 1 is unchanged');

-- ===========================================================================
-- Flags
-- ===========================================================================
insert into ids select 'f_placeholder', id from public.review_flags where draft_version_id = (select value from ids where key = 'v2') and source = 'placeholder';
insert into ids select 'f_claim', id from public.review_flags where draft_version_id = (select value from ids where key = 'v2') and source = 'claims';
insert into ids select 'f_model', id from public.review_flags where draft_version_id = (select value from ids where key = 'v2') and source = 'model';
insert into ids select 'f_rep', id from public.review_flags where draft_version_id = (select value from ids where key = 'v2') and source = 'repetition';
insert into ids select 'f_old', id from public.review_flags where draft_version_id = (select value from ids where key = 'v1') and source = 'claims';

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000a1","role":"authenticated","aal":"aal2"}', true);
select throws_ok(format($$select public.resolve_review_flag(%L, 'resolve', 'Founder told me')$$, (select value from ids where key = 'f_placeholder')),
  '22023', null, 'a placeholder cannot be resolved, only replaced in the text');
select throws_ok(format($$select public.resolve_review_flag(%L, 'override', 'Good enough')$$, (select value from ids where key = 'f_claim')),
  '22023', null, 'a blocking flag cannot be overridden');
select throws_ok(format($$select public.resolve_review_flag(%L, 'resolve', '')$$, (select value from ids where key = 'f_claim')),
  '22023', null, 'resolving a blocking flag needs a reason');
select lives_ok(format($$select public.resolve_review_flag(%L, 'resolve', 'Rephrased as opinion with the founder')$$, (select value from ids where key = 'f_claim')),
  'a blocking claim flag is resolved with a reason');
select throws_ok(format($$select public.resolve_review_flag(%L, 'override', 'ok')$$, (select value from ids where key = 'f_rep')),
  '22023', null, 'an override needs a real reason');
select lives_ok(format($$select public.resolve_review_flag(%L, 'override', 'A deliberate follow-up to the March post')$$, (select value from ids where key = 'f_rep')),
  'a repetition warning is overridden with a reason');
select results_eq(format($$select status::text, resolution_note, resolved_by::text from public.review_flags where id = %L$$, (select value from ids where key = 'f_rep')),
  $$values ('overridden', 'A deliberate follow-up to the March post', '00000000-0000-4000-8000-0000000000a1')$$,
  'the override records who and why');
select throws_ok(format($$select public.resolve_review_flag(%L, 'resolve', 'Old version')$$, (select value from ids where key = 'f_old')),
  'P0002', null, 'flags of an old version cannot be changed');
select is((select count(*)::int from public.audit_events where action in ('flag.resolved', 'flag.overridden')), 2, 'flag decisions are audited');

-- ===========================================================================
-- Admin edits
-- ===========================================================================
select throws_ok(format($$select public.save_draft_version(%L, 'Text', '{"Only hook"}', 3::smallint, '', '[]', '[]')$$, (select value from ids where key = 'draft')),
  '22023', null, 'the chosen opening line must exist');
select is(public.save_draft_version((select value from ids where key = 'draft'), 'Edited by the admin.', '{"Hook one"}', 0::smallint, 'Tightened',
  '[]', '[{"kind": "style", "severity": "warning", "source": "lint", "message": "Avoid \"synergy\"."}]'), 3, 'an admin edit is version 3');
select results_eq($$select v.author_kind::text, v.created_by::text, v.selected_hook_index, v.rationale
    from public.draft_versions v join public.drafts d on d.current_version_id = v.id where d.id = (select value from ids where key = 'draft')$$,
  $$values ('admin', '00000000-0000-4000-8000-0000000000a1', 0::smallint, 'Internal reasoning')$$, 'the edit is attributed to the admin');
select results_eq($$select f.source, f.status::text from public.review_flags f join public.drafts d on d.current_version_id = f.draft_version_id
    where d.id = (select value from ids where key = 'draft') order by f.source$$,
  $$values ('lint', 'open'), ('model', 'open'), ('repetition', 'overridden')$$,
  'lint flags are recomputed; model and repetition flags carry over with their decisions');

-- ===========================================================================
-- State machine (Phase 4b part)
-- ===========================================================================
select throws_ok(format($$select public.transition_draft(%L, 'published', '')$$, (select value from ids where key = 'draft')),
  '22023', null, 'admin review cannot jump to published');
select throws_ok(format($$select public.transition_draft(%L, 'approved', '')$$, (select value from ids where key = 'draft')),
  '22023', null, 'only a founder approval approves (Phase 7)');
select lives_ok(format($$select public.transition_draft(%L, 'drafting', 'More work')$$, (select value from ids where key = 'draft')), 'back to drafting');
select lives_ok(format($$select public.transition_draft(%L, 'archived', '')$$, (select value from ids where key = 'draft')), 'archive');
select throws_ok(format($$select public.save_draft_version(%L, 'x', '{}', null, '', '[]', '[]')$$, (select value from ids where key = 'draft')),
  '22023', null, 'an archived draft cannot be edited');
select lives_ok(format($$select public.transition_draft(%L, 'admin_review', '')$$, (select value from ids where key = 'draft')), 'restore to review');
select lives_ok(format($$select public.transition_draft(%L, 'rejected', 'Off-brief')$$, (select value from ids where key = 'draft')), 'reject');
select throws_ok(format($$select public.transition_draft(%L, 'admin_review', '')$$, (select value from ids where key = 'draft')),
  '22023', null, 'a rejected draft stays rejected');
select throws_ok($$update public.drafts set status = 'published'$$, '42501', null, 'status cannot be written directly');

-- ===========================================================================
-- Repetition pre-filter
-- ===========================================================================
reset role;
-- Another founder's live concept making the same argument.
insert into public.concepts (company_id, founder_id, target_month, brief_version_id, title, core_argument, format, fingerprint)
values ('00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-0000000000f3', '2026-11-01',
  '00000000-0000-4000-8000-0000000000b1', 'Updates as a product', 'Predictable updates win fleets', 'opinion',
  '{"argument_key": "Status updates are a product"}');
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000a1","role":"authenticated","aal":"aal2"}', true);
select results_eq($$select compared_type, same_argument from public.repetition_candidates('00000000-0000-4000-8000-000000000001',
    'Fleets pay for predictability, not speed', 'Status updates are a product', '2026-11-01', null, null) order by compared_type$$,
  $$values ('concept'::text, true)$$, 'a live concept with the same argument key is found; rejected drafts and drafted concepts are not');
select results_eq($$select compared_type from public.repetition_candidates('00000000-0000-4000-8000-000000000001',
    'A fleet manager told me that the hardest part of a repair is not the repair. It is not knowing when the van comes back.',
    '', '2026-11-01', null, null)$$,
  $$values ('published_post'::text)$$, 'a published LinkedIn post with similar text is found');
select throws_ok($$select * from public.repetition_candidates('00000000-0000-4000-8000-000000000002', 'Fleets pay for predictability', 'status updates are a product', '2026-11-01', null, null)$$,
  '42501', null, 'another company''s id is refused for the admin''s session');
reset role;

select * from finish();
rollback;
