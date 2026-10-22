-- Phase 9 tests: the publish gate on every path, scheduling, copying,
-- recording publications, external posts, metrics, and access.

begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

-- Seed: company …001; admin a1; CEO c1 → f1 (America/Los_Angeles); CTO c2 → f2; brief 2026-11 v1 (…b1).
create temporary table ids (key text primary key, value uuid);
grant all on ids to public;
create function pg_temp.id(p_key text) returns uuid language sql stable as $$ select value from ids where key = p_key $$;
grant execute on function pg_temp.id(text) to public;
create function pg_temp.as_user(p_sub text, p_aal text default 'aal1') returns void language sql as $$
  select set_config('request.jwt.claims',
    jsonb_build_object('sub', p_sub, 'role', 'authenticated', 'aal', p_aal)::text, true);
$$;
grant execute on function pg_temp.as_user(text, text) to public;

insert into public.concepts (company_id, founder_id, target_month, brief_version_id, title, core_argument, format, status, fingerprint)
values ('00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-0000000000f1', '2026-11-01',
  '00000000-0000-4000-8000-0000000000b1', 'Publishing concept', 'Arg', 'story', 'selected', '{}');
insert into ids select 'concept', id from public.concepts where title = 'Publishing concept';

-- A clean draft (no flags), written by the runner. p_share: shared with the founder.
create function pg_temp.draft(p_key text, p_body text, p_share boolean) returns uuid language plpgsql as $$
declare
  v_run uuid;
  v_version uuid;
  v_draft uuid;
begin
  perform set_config('role', 'authenticated', true);
  perform pg_temp.as_user('00000000-0000-4000-8000-0000000000a1', 'aal2');
  select run_id into v_run from public.request_generation('draft', '00000000-0000-4000-8000-0000000000f1', '2026-11-01',
    'fake', 'claude-opus-5-5', 'draft', 2,
    '{"brief_version_id": "00000000-0000-4000-8000-0000000000b1", "voice_profile_version_id": null, "example_ids": []}',
    jsonb_build_object('concept_id', pg_temp.id('concept')), 0.4, p_key);
  perform set_config('role', 'service_role', true);
  perform public.claim_generation_run(v_run);
  v_version := public.complete_draft_run(v_run, 'claude-opus-5-5', '{}', jsonb_build_object(
    'body', p_body, 'alternative_hooks', jsonb_build_array('A chosen opening.', 'Another opening.'),
    'rationale', 'r', 'fingerprint', '{}'::jsonb, 'claims', '[]'::jsonb, 'flags', '[]'::jsonb, 'checks', '[]'::jsonb));
  select draft_id into v_draft from public.draft_versions where id = v_version;
  if p_share then
    perform set_config('role', 'authenticated', true);
    perform pg_temp.as_user('00000000-0000-4000-8000-0000000000a1', 'aal2');
    perform public.share_draft(v_draft, '{}');
  end if;
  perform set_config('role', 'postgres', true);
  return v_draft;
end;
$$;

-- The founder approves the version they see.
create function pg_temp.approve(p_draft uuid) returns uuid language plpgsql as $$
declare
  v_id uuid;
  v_version uuid := (select current_version_id from public.drafts where id = p_draft);
begin
  perform set_config('role', 'authenticated', true);
  perform pg_temp.as_user('00000000-0000-4000-8000-0000000000c1');
  v_id := public.approve_draft(p_draft, v_version, '');
  perform set_config('role', 'postgres', true);
  return v_id;
end;
$$;

-- Slots for the CEO, and one for the CTO.
insert into public.calendar_slots (id, company_id, founder_id, slot_date, ordinal, kind, status) values
  ('00000000-0000-4000-8000-00000000510a', '00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-0000000000f1', '2026-11-10', 9, 'manual', 'open'),
  ('00000000-0000-4000-8000-00000000510b', '00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-0000000000f1', '2026-11-12', 9, 'manual', 'open'),
  ('00000000-0000-4000-8000-00000000510c', '00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-0000000000f1', '2026-11-14', 9, 'manual', 'skipped'),
  ('00000000-0000-4000-8000-00000000510d', '00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-0000000000f2', '2026-11-10', 9, 'manual', 'open');

insert into ids select 'unshared', pg_temp.draft('publish-key-unshared', E'Not shared.\n\nYet.', false);
insert into ids select 'shared', pg_temp.draft('publish-key-shared0', E'Shared, not approved.\n\nYet.', true);
insert into ids select 'draft', pg_temp.draft('publish-key-draft00', E'Approved text.\n\nSecond paragraph.', true);
insert into ids select 'approval', pg_temp.approve(pg_temp.id('draft'));

-- ===========================================================================
-- The gate: every invalid precondition, on every path (criterion 1)
-- ===========================================================================
set local role authenticated;
select pg_temp.as_user('00000000-0000-4000-8000-0000000000a1', 'aal2');
select throws_ok(format($$select public.schedule_draft(%L, '2026-11-10 09:00-08', null)$$, pg_temp.id('unshared')), '22023',
  'only an approved draft can be scheduled or published (this one is admin_review)', 'a draft in admin review cannot be scheduled');
select throws_ok(format($$select public.approved_text(%L)$$, pg_temp.id('unshared')), '22023', null, 'nor copied');
select throws_ok(format($$select public.record_publication(%L, now(), 'https://www.linkedin.com/posts/x', null)$$, pg_temp.id('unshared')),
  '22023', null, 'nor recorded as published');
select throws_ok(format($$select public.schedule_draft(%L, '2026-11-10 09:00-08', null)$$, pg_temp.id('shared')), '22023', null,
  'a draft the founder has not approved cannot be scheduled');
select throws_ok(format($$select public.record_publication(%L, now(), 'https://www.linkedin.com/posts/x', null)$$, pg_temp.id('shared')),
  '22023', null, 'nor recorded as published');
reset role;

-- An open blocking flag on the approved version blocks every path.
insert into public.review_flags (draft_version_id, company_id, kind, severity, source, message)
select current_version_id, company_id, 'unsupported_claim', 'blocking', 'claims', 'Raised after approval'
from public.drafts where id = pg_temp.id('draft');
set local role authenticated;
select pg_temp.as_user('00000000-0000-4000-8000-0000000000a1', 'aal2');
select throws_ok(format($$select public.schedule_draft(%L, '2026-11-10 09:00-08', null)$$, pg_temp.id('draft')), '22023',
  'a blocking flag is open', 'an open blocking flag blocks scheduling');
select throws_ok(format($$select public.approved_text(%L)$$, pg_temp.id('draft')), '22023', 'a blocking flag is open', 'copying');
select throws_ok(format($$select public.record_publication(%L, now() - interval '1 hour', 'https://www.linkedin.com/posts/x', null)$$, pg_temp.id('draft')),
  '22023', 'a blocking flag is open', 'and recording');
reset role;
update public.review_flags set status = 'resolved', resolved_at = now(), resolution_note = 'checked'
where message = 'Raised after approval';

-- A draft set to "approved" without a valid approval (a direct write by the owner) is still refused.
insert into ids select 'forged', pg_temp.draft('publish-key-forged0', E'Forged.\n\nText.', true);
insert into public.approvals (company_id, draft_id, draft_version_id, body_hash, approver_user_id, approver_role, decision)
select company_id, id, current_version_id, (select body_normalized_hash from public.draft_versions where id = current_version_id),
  '00000000-0000-4000-8000-0000000000a1', 'admin', 'approved'
from public.drafts where id = pg_temp.id('forged');
update public.drafts set status = 'approved' where id = pg_temp.id('forged');
set local role authenticated;
select pg_temp.as_user('00000000-0000-4000-8000-0000000000a1', 'aal2');
select throws_ok(format($$select public.schedule_draft(%L, '2026-11-10 09:00-08', null)$$, pg_temp.id('forged')), '22023',
  'the draft has no valid approval of its current version', 'an approval by anyone but the founder never passes the gate');
select throws_ok(format($$select public.record_publication(%L, now() - interval '1 hour', 'https://www.linkedin.com/posts/f', null)$$, pg_temp.id('forged')),
  '22023', 'the draft has no valid approval of its current version', 'not even to record it');
select throws_ok(format($$select public.approved_text(%L)$$, pg_temp.id('forged')), '22023', null, 'or copy it');
reset role;

-- Only the admin, through the functions.
set local role authenticated;
select pg_temp.as_user('00000000-0000-4000-8000-0000000000c1');
select throws_ok(format($$select public.schedule_draft(%L, '2026-11-10 09:00-08', null)$$, pg_temp.id('draft')), '42501', null,
  'a founder cannot schedule, even their own approved draft');
select throws_ok(format($$select public.record_publication(%L, now(), 'https://www.linkedin.com/posts/x', null)$$, pg_temp.id('draft')),
  '42501', null, 'nor record a publication');
select throws_ok(format($$select public.approved_text(%L)$$, pg_temp.id('draft')), '42501', null, 'nor call the copy function');
select is_empty('select 1 from public.publications', 'a founder cannot read publications directly');
reset role;
set local role authenticated;
select pg_temp.as_user('00000000-0000-4000-8000-0000000000a1', 'aal1');
select throws_ok(format($$select public.schedule_draft(%L, '2026-11-10 09:00-08', null)$$, pg_temp.id('draft')), '42501', null,
  'an admin without MFA cannot schedule');
reset role;
set local role authenticated;
select pg_temp.as_user('00000000-0000-4000-8000-0000000000a1', 'aal2');
select throws_ok(format($$update public.drafts set status = 'published' where id = %L$$, pg_temp.id('draft')), '42501', null,
  'the admin cannot set a draft published directly');
select throws_ok(format($$insert into public.publications (company_id, founder_id, draft_id, published_at, linkedin_url, published_text, published_text_hash)
  values ('00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-0000000000f1', %L, now(), 'https://www.linkedin.com/posts/y', 'x', '\x00')$$, pg_temp.id('draft')),
  '42501', null, 'nor insert a publication directly (criterion 1, through a direct API call with an admin token)');
reset role;
set local role anon;
select set_config('request.jwt.claims', '{"role":"anon"}', true);
select throws_ok('select * from public.publications', '42501', null, 'anon cannot read publications');
select throws_ok('select * from public.performance_snapshots', '42501', null, 'anon cannot read metrics');
reset role;

-- ===========================================================================
-- Scheduling (criterion 2: rescheduling keeps the approval)
-- ===========================================================================
set local role authenticated;
select pg_temp.as_user('00000000-0000-4000-8000-0000000000a1', 'aal2');
select throws_ok(format($$select public.schedule_draft(%L, '2026-11-11 09:00-08', '00000000-0000-4000-8000-00000000510a')$$, pg_temp.id('draft')),
  '22023', null, 'the time must be on the slot''s day');
select throws_ok(format($$select public.schedule_draft(%L, '2026-11-14 09:00-08', '00000000-0000-4000-8000-00000000510c')$$, pg_temp.id('draft')),
  '22023', 'that slot is not free', 'a skipped slot cannot be used');
select throws_ok(format($$select public.schedule_draft(%L, '2026-11-10 09:00-08', '00000000-0000-4000-8000-00000000510d')$$, pg_temp.id('draft')),
  'P0002', null, 'another founder''s slot cannot be used');
select lives_ok(format($$select public.schedule_draft(%L, '2026-11-10 09:00-08', '00000000-0000-4000-8000-00000000510a')$$, pg_temp.id('draft')),
  'the approved draft is scheduled into a slot');
reset role;
select results_eq(format($$select d.status::text, d.scheduled_for = '2026-11-10 09:00-08'::timestamptz, s.status::text, s.draft_id = d.id
    from public.drafts d join public.calendar_slots s on s.id = '00000000-0000-4000-8000-00000000510a' where d.id = %L$$, pg_temp.id('draft')),
  $$values ('scheduled', true, 'filled', true)$$, 'scheduled, with the slot filled');

set local role authenticated;
select pg_temp.as_user('00000000-0000-4000-8000-0000000000a1', 'aal2');
select lives_ok(format($$select public.schedule_draft(%L, '2026-11-12 10:30-08', '00000000-0000-4000-8000-00000000510b')$$, pg_temp.id('draft')),
  'rescheduled to another slot');
reset role;
select results_eq($$select id::text, status::text from public.calendar_slots where id in ('00000000-0000-4000-8000-00000000510a', '00000000-0000-4000-8000-00000000510b') order by id$$,
  $$values ('00000000-0000-4000-8000-00000000510a', 'open'), ('00000000-0000-4000-8000-00000000510b', 'filled')$$,
  'the old slot is freed and the new one filled');
select is((private.valid_approval(pg_temp.id('draft'))).id, pg_temp.id('approval'), 'rescheduling keeps the approval');

insert into ids select 'other', pg_temp.draft('publish-key-other00', E'Other approved.\n\nText.', true);
insert into ids select 'other_approval', pg_temp.approve(pg_temp.id('other'));
set local role authenticated;
select pg_temp.as_user('00000000-0000-4000-8000-0000000000a1', 'aal2');
select throws_ok(format($$select public.schedule_draft(%L, '2026-11-12 09:00-08', '00000000-0000-4000-8000-00000000510b')$$, pg_temp.id('other')),
  '22023', 'that slot is not free', 'a slot holds one draft');
select lives_ok(format($$select public.schedule_draft(%L, '2026-11-20 09:00-08', null)$$, pg_temp.id('other')), 'a draft can be scheduled without a slot');
select lives_ok(format($$select public.unschedule_draft(%L)$$, pg_temp.id('other')), 'and unscheduled');
reset role;
select results_eq(format($$select status::text, scheduled_for, proposed_date from public.drafts where id = %L$$, pg_temp.id('other')),
  $$values ('approved', null::timestamptz, '2026-11-20'::date)$$, 'unscheduling returns it to approved, keeping the date as a proposal');
select is((private.valid_approval(pg_temp.id('other'))).id, pg_temp.id('other_approval'), 'and keeps the approval');

-- Editing the text of a scheduled draft withdraws the approval and unschedules it (criterion 2).
set local role authenticated;
select pg_temp.as_user('00000000-0000-4000-8000-0000000000a1', 'aal2');
select lives_ok(format($$select public.schedule_draft(%L, '2026-11-10 09:00-08', '00000000-0000-4000-8000-00000000510a')$$, pg_temp.id('other')),
  'the other draft is scheduled into a slot');
select is(public.save_draft_version(pg_temp.id('other'), E'Other approved, edited.\n\nText.', array['A chosen opening.', 'Another opening.'], null, 'edit', '[]', '[]'),
  2, 'the admin edits the scheduled draft');
reset role;
select results_eq(format($$select status::text, scheduled_for, private.valid_approval(id) is null from public.drafts where id = %L$$, pg_temp.id('other')),
  $$values ('admin_review', null::timestamptz, true)$$, 'the approval is withdrawn and the draft unscheduled');
select is((select status::text from public.calendar_slots where id = '00000000-0000-4000-8000-00000000510a'), 'open', 'its slot is freed');
set local role authenticated;
select pg_temp.as_user('00000000-0000-4000-8000-0000000000a1', 'aal2');
select throws_ok(format($$select public.schedule_draft(%L, '2026-11-21 09:00-08', null)$$, pg_temp.id('other')), '22023', null,
  'and it cannot be scheduled again until the founder approves the new text');
reset role;

-- ===========================================================================
-- Copying (criterion 3)
-- ===========================================================================
set local role authenticated;
select pg_temp.as_user('00000000-0000-4000-8000-0000000000a1', 'aal2');
select is(public.approved_text(pg_temp.id('draft')), E'Approved text.\n\nSecond paragraph.', 'the copied text is the approved version, byte for byte');
reset role;
select is((select count(*)::int from public.audit_events where action = 'draft.text_copied'), 1, 'copying is audited');
select is(private.publishable_text(row(gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), 1,
    E'First line.\n\nRest.', array['Chosen line.'], 0::smallint, ''::bytea, 0, 'ai', null, null, null, '', null, '{}', '', now())::public.draft_versions),
  E'Chosen line.\n\nRest.', 'a chosen opening line replaces the first line');

-- ===========================================================================
-- Recording (criteria 4 and 5)
-- ===========================================================================
set local role authenticated;
select pg_temp.as_user('00000000-0000-4000-8000-0000000000a1', 'aal2');
select throws_ok(format($$select public.record_publication(%L, now() + interval '2 days', 'https://www.linkedin.com/posts/a', null)$$, pg_temp.id('draft')),
  '22023', null, 'a publication cannot be dated in the future');
select throws_ok(format($$select public.record_publication(%L, now() - interval '1 hour', 'https://evil.example/posts/a', null)$$, pg_temp.id('draft')),
  '23514', null, 'the link must be a LinkedIn link');
insert into ids select 'pub', public.record_publication(pg_temp.id('draft'), now() - interval '1 hour',
  'https://www.linkedin.com/posts/ceo_approved-1', null);
select throws_ok(format($$select public.record_publication(%L, now() - interval '1 hour', 'https://www.linkedin.com/posts/ceo_approved-2', null)$$, pg_temp.id('draft')),
  null, null, 'criterion 5: a second publication for the same draft is rejected');
reset role;
select results_eq(format($$select p.linkedin_url, p.published_text, p.differs_from_approved, p.is_external, p.approval_id = %L,
    p.approved_version_id = d.current_version_id, p.published_at < now(), p.published_text_hash = sha256(convert_to(p.published_text, 'UTF8'))
    from public.publications p join public.drafts d on d.id = p.draft_id where p.id = %L$$, pg_temp.id('approval'), pg_temp.id('pub')),
  $$values ('https://www.linkedin.com/posts/ceo_approved-1', E'Approved text.\n\nSecond paragraph.', false, false, true, true, true, true)$$,
  'criterion 4: URL, date and the actual text are stored, with the approval and version they rest on');
select results_eq(format($$select d.status::text, s.status::text from public.drafts d join public.calendar_slots s on s.draft_id = d.id where d.id = %L$$, pg_temp.id('draft')),
  $$values ('published', 'filled')$$, 'the draft is published and keeps its slot');
select results_eq($$select kind::text, source_url, approved_for_voice from public.writing_examples where source_url = 'https://www.linkedin.com/posts/ceo_approved-1'$$,
  $$values ('published_linkedin', 'https://www.linkedin.com/posts/ceo_approved-1', false)$$,
  'the published post becomes a writing example, not yet approved for voice');
select throws_ok(format($$update public.publications set published_text = 'changed' where id = %L$$, pg_temp.id('pub')), null, null,
  'a publication record cannot be changed');

-- A published draft is final.
set local role authenticated;
select pg_temp.as_user('00000000-0000-4000-8000-0000000000a1', 'aal2');
select throws_ok(format($$select public.transition_draft(%L, 'archived', '')$$, pg_temp.id('draft')), '22023', null, 'a published draft cannot be archived');
select throws_ok(format($$select public.schedule_draft(%L, '2026-11-25 09:00-08', null)$$, pg_temp.id('draft')), '22023', null, 'nor rescheduled');
select throws_ok(format($$select public.save_draft_version(%L, 'x', '{}', null, '', '[]', '[]')$$, pg_temp.id('draft')), '22023', null, 'nor edited');
reset role;

-- A differing text is stored, flagged, audited and proposed as a one-off edit.
insert into ids select 'third', pg_temp.draft('publish-key-third00', E'Third approved.\n\nText here.', true);
insert into ids select 'third_approval', pg_temp.approve(pg_temp.id('third'));
set local role authenticated;
select pg_temp.as_user('00000000-0000-4000-8000-0000000000a1', 'aal2');
insert into ids select 'pub3', public.record_publication(pg_temp.id('third'), now() - interval '30 minutes',
  'https://www.linkedin.com/posts/ceo_third', E'Third approved!\n\nText here.  ');
reset role;
select results_eq(format($$select differs_from_approved, approved_text, published_text from public.publications where id = %L$$, pg_temp.id('pub3')),
  $$values (true, E'Third approved.\n\nText here.', E'Third approved!\n\nText here.')$$, 'a different posted text is stored next to the approved one');
select is((select count(*)::int from public.audit_events where action = 'publication.text_differs' and entity_id = pg_temp.id('pub3')), 1,
  'and audited');
select is((select count(*)::int from public.feedback_signals where proposed_by = 'system' and kind = 'one_off'
  and founder_id = '00000000-0000-4000-8000-0000000000f1'), 1, 'and proposed to the admin as a one-off edit');

-- Whitespace differences only are not a difference.
insert into ids select 'fourth', pg_temp.draft('publish-key-fourth0', E'Fourth.\n\nText.', true);
select pg_temp.approve(pg_temp.id('fourth'));
set local role authenticated;
select pg_temp.as_user('00000000-0000-4000-8000-0000000000a1', 'aal2');
insert into ids select 'pub4', public.record_publication(pg_temp.id('fourth'), now() - interval '10 minutes',
  'https://www.linkedin.com/posts/ceo_fourth', E'Fourth.  \r\n\r\nText.\n');
reset role;
select is((select differs_from_approved from public.publications where id = pg_temp.id('pub4')), false,
  'line endings and trailing spaces are not a difference');

-- ===========================================================================
-- Withdrawing a scheduled draft
-- ===========================================================================
insert into ids select 'fifth', pg_temp.draft('publish-key-fifth00', E'Fifth.\n\nText.', true);
select pg_temp.approve(pg_temp.id('fifth'));
set local role authenticated;
select pg_temp.as_user('00000000-0000-4000-8000-0000000000a1', 'aal2');
select lives_ok(format($$select public.schedule_draft(%L, '2026-11-10 08:00-08', '00000000-0000-4000-8000-00000000510a')$$, pg_temp.id('fifth')), 'scheduled');
reset role;
set local role authenticated;
select pg_temp.as_user('00000000-0000-4000-8000-0000000000c1');
select results_eq(format('select scheduled_for is not null, published_at from public.founder_publishing() where draft_id = %L', pg_temp.id('fifth')),
  $$values (true, null::timestamptz)$$, 'the founder sees when their post goes out');
select lives_ok(format($$select public.revoke_approval(%L, 'not yet')$$, pg_temp.id('fifth')), 'the founder withdraws approval of a scheduled draft');
reset role;
select results_eq(format($$select d.status::text, d.scheduled_for, (select status::text from public.calendar_slots where id = '00000000-0000-4000-8000-00000000510a')
    from public.drafts d where d.id = %L$$, pg_temp.id('fifth')),
  $$values ('founder_review', null::timestamptz, 'open')$$, 'it is unscheduled and its slot freed');

-- ===========================================================================
-- External publications and metrics
-- ===========================================================================
set local role authenticated;
select pg_temp.as_user('00000000-0000-4000-8000-0000000000a1', 'aal2');
insert into ids select 'ext', public.record_external_publication('00000000-0000-4000-8000-0000000000f2', now() - interval '2 hours',
  'https://www.linkedin.com/posts/cto_own-post', 'A post the CTO wrote on their own.');
select throws_ok($$select public.record_external_publication('00000000-0000-4000-8000-0000000000f2', now() - interval '1 hour',
  'https://www.linkedin.com/posts/cto_own-post', 'Again.')$$, '23505', null, 'the same LinkedIn post cannot be recorded twice');
select throws_ok(format($$select public.add_performance_snapshot(%L, now(), '{"likes": 3}')$$, pg_temp.id('pub')), '22023', null,
  'only known metrics');
select throws_ok(format($$select public.add_performance_snapshot(%L, now(), '{"reactions": -1}')$$, pg_temp.id('pub')), '22023', null,
  'whole, non-negative numbers');
select throws_ok(format($$select public.add_performance_snapshot(%L, now() - interval '1 day', '{"reactions": 3}')$$, pg_temp.id('pub')), '22023', null,
  'captured after publication');
select lives_ok(format($$select public.add_performance_snapshot(%L, now(), '{"impressions": 1200, "reactions": 45}')$$, pg_temp.id('pub')),
  'metrics are entered by hand');
reset role;
select results_eq(format($$select is_external, draft_id, approval_id, approved_text, founder_id::text from public.publications where id = %L$$, pg_temp.id('ext')),
  $$values (true, null::uuid, null::uuid, null::text, '00000000-0000-4000-8000-0000000000f2')$$,
  'an external post has no draft or approval: it never counts as an approved studio post');
select is((select count(*)::int from public.writing_examples where source_url = 'https://www.linkedin.com/posts/cto_own-post' and kind = 'published_linkedin'), 1,
  'it is kept as a published post for repetition checks');
select results_eq(format($$select metrics ->> 'impressions', metrics ->> 'reactions' from public.performance_snapshots where publication_id = %L$$, pg_temp.id('pub')),
  $$values ('1200', '45')$$, 'the snapshot is stored');

set local role authenticated;
select pg_temp.as_user('00000000-0000-4000-8000-0000000000c2');
select is_empty(format('select 1 from public.founder_publishing() where draft_id = %L', pg_temp.id('draft')),
  'another founder sees nothing of this founder''s publishing');
select is_empty('select 1 from public.performance_snapshots', 'founders cannot read metrics');
reset role;

select * from finish();
rollback;
