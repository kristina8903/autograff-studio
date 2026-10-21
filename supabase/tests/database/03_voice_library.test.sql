-- Phase 3 tests: voice profiles, writing examples, feedback signals (docs/PHASES.md Phase 3).

begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

-- Seed: admin a1; CEO c1 → founder f1 (voice profile v1, 4 examples: 3 approved,
-- 1 of them held out); CTO c2 → f2 (nothing); COO f3 (1 approved example).
-- Signals for f1: one stable_preference, one one_off, both proposed.
create temporary table ids (key text primary key, value uuid);
grant all on ids to public;
insert into ids select 'stable', id from public.feedback_signals where kind = 'stable_preference';
insert into ids select 'one_off', id from public.feedback_signals where kind = 'one_off';
insert into ids select 'ceo_example', id from public.writing_examples
  where founder_id = '00000000-0000-4000-8000-0000000000f1' and format = 'list';

-- ===========================================================================
-- anon
-- ===========================================================================
set local role anon;
select set_config('request.jwt.claims', '{"role":"anon"}', true);
select throws_ok('select * from public.voice_profiles', '42501', null, 'anon cannot read voice profiles');
select throws_ok('select * from public.voice_profile_versions', '42501', null, 'anon cannot read voice versions');
select throws_ok('select * from public.writing_examples', '42501', null, 'anon cannot read examples');
select throws_ok('select * from public.feedback_signals', '42501', null, 'anon cannot read feedback signals');
select throws_ok($$select public.add_writing_examples('00000000-0000-4000-8000-0000000000f1', '[{"body":"x"}]')$$,
  '42501', null, 'anon cannot add examples');
reset role;

-- ===========================================================================
-- Founder A (CEO): own profile and examples only; no signals; limited writes
-- ===========================================================================
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000c1","role":"authenticated","aal":"aal1"}', true);
select results_eq('select founder_id::text from public.voice_profiles', $$values ('00000000-0000-4000-8000-0000000000f1')$$,
  'founder reads their own voice profile');
select results_eq('select version_no from public.voice_profile_versions', $$values (1)$$, 'founder reads their own versions');
select results_eq('select count(*)::int from public.writing_examples', $$values (4)$$, 'founder reads all their own examples');
select is_empty($$select 1 from public.writing_examples where founder_id <> '00000000-0000-4000-8000-0000000000f1'$$,
  'founder cannot read another founder''s examples');
select is_empty('select 1 from public.feedback_signals', 'founder cannot read feedback signals');

select results_eq(
  $$select public.add_writing_examples('00000000-0000-4000-8000-0000000000f1',
      '[{"body":"A post I am happy to share.","approved_for_voice":false,"kind":"approved_example"}]')$$,
  $$values ('{"added": 1, "duplicates": 0}'::jsonb)$$, 'founder adds their own approved example');
select results_eq($$select approved_for_voice, kind::text from public.writing_examples where body = 'A post I am happy to share.'$$,
  $$values (true, 'approved_example')$$, 'a founder''s own example is approved for voice');
select throws_ok($$select public.add_writing_examples('00000000-0000-4000-8000-0000000000f1', '[{"body":"x","kind":"published_linkedin"}]')$$,
  '42501', null, 'founder can only add approved examples');
select throws_ok($$select public.add_writing_examples('00000000-0000-4000-8000-0000000000f3', '[{"body":"Not mine"}]')$$,
  '42501', null, 'founder cannot add examples for another founder');
select throws_ok(format($$select public.update_writing_example(%L, false, false, null, '{}')$$, (select value from ids where key = 'ceo_example')),
  '42501', null, 'founder cannot change example settings');
select throws_ok(format($$select public.delete_writing_example(%L)$$, (select value from ids where key = 'ceo_example')),
  '42501', null, 'founder cannot delete examples');
select throws_ok($$select public.save_voice_profile_version('00000000-0000-4000-8000-0000000000f1', '{}', '{}', '{}', '{}', '{}', '{}', '{}', '', 'mine', '{}')$$,
  '42501', null, 'founder cannot edit their voice profile');
select throws_ok($$select public.add_feedback_signal('00000000-0000-4000-8000-0000000000f1', 'one_off', null, 'x')$$,
  '42501', null, 'founder cannot add feedback signals');
select throws_ok($$update public.writing_examples set approved_for_voice = false$$, '42501', null, 'founder cannot write examples directly');
select throws_ok($$insert into public.voice_profile_versions (profile_id, company_id, founder_id, version_no, change_reason)
  values ('00000000-0000-4000-8000-0000000000d0', '00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-0000000000f1', 9, 'x')$$,
  '42501', null, 'founder cannot write voice versions directly');
reset role;

-- ===========================================================================
-- Founder B (CTO): sees nothing of founder A
-- ===========================================================================
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000c2","role":"authenticated","aal":"aal1"}', true);
select is_empty('select 1 from public.voice_profiles', 'founder B cannot read founder A''s profile');
select is_empty('select 1 from public.voice_profile_versions', 'founder B cannot read founder A''s versions');
select is_empty('select 1 from public.writing_examples', 'founder B cannot read other founders'' examples');
reset role;

-- ===========================================================================
-- Admin without MFA
-- ===========================================================================
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000a1","role":"authenticated","aal":"aal1"}', true);
select is_empty('select 1 from public.voice_profiles', 'admin without MFA cannot read profiles');
select is_empty('select 1 from public.feedback_signals', 'admin without MFA cannot read signals');
select throws_ok($$select public.add_writing_examples('00000000-0000-4000-8000-0000000000f3', '[{"body":"x","kind":"other"}]')$$,
  '42501', null, 'admin without MFA counts as nobody''s founder');
reset role;

-- ===========================================================================
-- Admin: profiles and versions
-- ===========================================================================
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000a1","role":"authenticated","aal":"aal2"}', true);

select results_eq(
  $$select public.save_voice_profile_version('00000000-0000-4000-8000-0000000000f1', '{"humor":"none"}',
      '{" Here is what we saw ", ""}', '{"game-changer"}', '{"repair operations"}', '{}', '{"No em-dashes"}',
      '{"story":"Open with the moment"}', '', 'Less humor', '{}')$$,
  $$values (2)$$, 'saving creates the next version');
select results_eq($$select v.version_no, v.preferred_phrases from public.voice_profiles p
    join public.voice_profile_versions v on v.id = p.current_version_id
    where p.founder_id = '00000000-0000-4000-8000-0000000000f1'$$,
  $$values (2, '{"Here is what we saw"}'::text[])$$, 'the new version is current, lists cleaned');
select results_eq($$select attributes ->> 'humor' from public.voice_profile_versions
    where founder_id = '00000000-0000-4000-8000-0000000000f1' and version_no = 1$$,
  $$values ('light')$$, 'the earlier version is unchanged');
select results_eq(
  $$select public.save_voice_profile_version('00000000-0000-4000-8000-0000000000f2', '{}', '{}', '{}', '{}', '{}', '{}', '{}', '', 'First CTO profile', '{}')$$,
  $$values (1)$$, 'the first save creates the profile and version 1');
select throws_ok(
  $$select public.save_voice_profile_version('00000000-0000-4000-8000-0000000000f2', '{}', '{}', '{}', '{}', '{}', '{}', '{}', '', '  ', '{}')$$,
  '23514', null, 'a change reason is required');
select throws_ok(
  $$select public.save_voice_profile_version('00000000-0000-4000-8000-0000000000f2', '{}', '{}', '{}', '{}', '{}', '{}', '{"poem":"x"}', '', 'x', '{}')$$,
  '22023', null, 'format preferences must name a known format');
select throws_ok(
  $$select public.save_voice_profile_version('00000000-0000-4000-8000-0000000000fb', '{}', '{}', '{}', '{}', '{}', '{}', '{}', '', 'x', '{}')$$,
  'P0002', null, 'cannot write a profile for a founder outside the company');
select throws_ok($$update public.voice_profile_versions set notes = 'edited' where version_no = 1$$,
  '42501', null, 'admin cannot edit a version directly');
reset role;

-- Immutable even for the table owner.
select throws_ok($$update public.voice_profile_versions set notes = 'edited'$$, null, null, 'versions are immutable even for the owner');
select throws_ok($$delete from public.voice_profile_versions$$, null, null, 'versions cannot be deleted even by the owner');

-- ===========================================================================
-- Admin: feedback signals
-- ===========================================================================
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000a1","role":"authenticated","aal":"aal2"}', true);

select throws_ok(format($$select public.save_voice_profile_version('00000000-0000-4000-8000-0000000000f1', '{}', '{}', '{}', '{}', '{}', '{}', '{}', '', 'x', array[%L]::uuid[])$$,
    (select value from ids where key = 'one_off')),
  '22023', null, 'a one-off signal can never be applied to a voice profile');
select is_empty($$select 1 from public.voice_profile_versions where founder_id = '00000000-0000-4000-8000-0000000000f1' and version_no = 3$$,
  'and nothing was saved');
select throws_ok(format($$select public.save_voice_profile_version('00000000-0000-4000-8000-0000000000f2', '{}', '{}', '{}', '{}', '{}', '{}', '{}', '', 'x', array[%L]::uuid[])$$,
    (select value from ids where key = 'stable')),
  '22023', null, 'a signal cannot be applied to another founder''s profile');
select throws_ok(format($$select public.review_feedback_signal(%L, 'accept', '')$$, (select value from ids where key = 'stable')),
  '22023', null, 'a stable preference cannot be accepted without applying it');

select results_eq(format($$select public.save_voice_profile_version('00000000-0000-4000-8000-0000000000f1', '{}', '{}', '{"Never open with a question"}', '{}', '{}', '{}', '{}', '', 'From feedback', array[%L]::uuid[])$$,
    (select value from ids where key = 'stable')),
  $$values (3)$$, 'a stable preference is applied by saving a version with it');
select results_eq(format($$select s.status::text, v.version_no, v.source_feedback_ids = array[s.id], s.reviewed_by::text
    from public.feedback_signals s join public.voice_profile_versions v on v.id = s.applied_voice_profile_version_id
    where s.id = %L$$, (select value from ids where key = 'stable')),
  $$values ('accepted', 3, true, '00000000-0000-4000-8000-0000000000a1')$$,
  'the signal records the version it produced and who accepted it');
select throws_ok(format($$select public.save_voice_profile_version('00000000-0000-4000-8000-0000000000f1', '{}', '{}', '{}', '{}', '{}', '{}', '{}', '', 'again', array[%L]::uuid[])$$,
    (select value from ids where key = 'stable')),
  '22023', null, 'a signal can be applied only once');

select lives_ok(format($$select public.review_feedback_signal(%L, 'accept', 'Noted for this post')$$, (select value from ids where key = 'one_off')),
  'a one-off signal can be accepted (recorded only)');
select results_eq(format($$select status::text, applied_voice_profile_version_id is null from public.feedback_signals where id = %L$$, (select value from ids where key = 'one_off')),
  $$values ('accepted', true)$$, 'an accepted one-off signal changes no profile');
select throws_ok(format($$select public.review_feedback_signal(%L, 'reject', '')$$, (select value from ids where key = 'one_off')),
  '22023', null, 'a reviewed signal cannot be reviewed again');

select lives_ok($$select public.add_feedback_signal('00000000-0000-4000-8000-0000000000f1', 'editorial_correction', 'story', 'Do not name competitors')$$,
  'admin adds an editorial correction');
select results_eq($$select format is null, proposed_by::text, status::text from public.feedback_signals where statement = 'Do not name competitors'$$,
  $$values (true, 'admin', 'proposed')$$, 'format is kept only for format preferences');
select throws_ok($$select public.add_feedback_signal('00000000-0000-4000-8000-0000000000f1', 'format_preference', null, 'Number first')$$,
  '23514', null, 'a format preference needs a format');
select lives_ok($$select public.review_feedback_signal((select id from public.feedback_signals where statement = 'Do not name competitors'), 'reject', 'Belongs in the brief')$$,
  'admin rejects a signal');
select is((select count(*)::int from public.audit_events where action like 'feedback.%' or action = 'voice.version_saved'), 6,
  'feedback and voice changes are audited (3 versions, add, accept, reject)');
reset role;

-- The constraints hold even for the table owner.
select throws_ok(format($$update public.feedback_signals set applied_voice_profile_version_id = (select current_version_id from public.voice_profiles where founder_id = '00000000-0000-4000-8000-0000000000f1') where id = %L$$,
    (select value from ids where key = 'one_off')),
  '23514', null, 'the database refuses to link a one-off signal to a profile version');
select throws_ok($$insert into public.feedback_signals (company_id, founder_id, kind, statement, proposed_by, status, reviewed_at)
  values ('00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-0000000000f1', 'stable_preference', 'x', 'admin', 'accepted', now())$$,
  '23514', null, 'a stable preference cannot be accepted without a profile version');

-- ===========================================================================
-- Admin: writing examples
-- ===========================================================================
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000a1","role":"authenticated","aal":"aal2"}', true);

select results_eq(
  $$select public.add_writing_examples('00000000-0000-4000-8000-0000000000f2', '[
      {"kind":"published_linkedin","body":"First CTO post.","source_url":"https://www.linkedin.com/posts/cto-1","published_at":"2026-09-01","format":"how_to","topics":[" APIs ","apis","Integrations"],"approved_for_voice":true},
      {"kind":"published_linkedin","body":"Second CTO post."},
      {"kind":"published_linkedin","body":"  First CTO post.  "}
    ]')$$,
  $$values ('{"added": 2, "duplicates": 1}'::jsonb)$$, 'bulk add skips duplicates');
select results_eq($$select topics, approved_for_voice from public.writing_examples where body = 'First CTO post.'$$,
  $$values ('{apis,integrations}'::text[], true)$$, 'topics are cleaned');
select results_eq($$select approved_for_voice from public.writing_examples where body = 'Second CTO post.'$$,
  $$values (false)$$, 'admin-added examples are not approved unless chosen');
select throws_ok($$select public.add_writing_examples('00000000-0000-4000-8000-0000000000f2', '[{"body":"x","source_url":"javascript:alert(1)"}]')$$,
  '23514', null, 'source URLs must be https');
select throws_ok($$select public.add_writing_examples('00000000-0000-4000-8000-0000000000f2', '[]')$$,
  '22023', null, 'at least one example');
select throws_ok($$select public.add_writing_examples('00000000-0000-4000-8000-0000000000fb', '[{"body":"x"}]')$$,
  'P0002', null, 'cannot add examples for a founder outside the company');

select lives_ok(format($$select public.update_writing_example(%L, true, true, 'list', '{Ops}')$$, (select value from ids where key = 'ceo_example')),
  'admin holds an example out for evaluation');
select results_eq(format($$select approved_for_voice, eval_holdout, topics from public.writing_examples where id = %L$$, (select value from ids where key = 'ceo_example')),
  $$values (true, true, '{ops}'::text[])$$, 'the example is held out');
select lives_ok(format($$select public.update_writing_example(%L, false, true, 'list', '{}')$$, (select value from ids where key = 'ceo_example')),
  'un-approving an example');
select results_eq(format($$select approved_for_voice, eval_holdout from public.writing_examples where id = %L$$, (select value from ids where key = 'ceo_example')),
  $$values (false, false)$$, 'an unapproved example is never in the evaluation set');
select lives_ok(format($$select public.delete_writing_example(%L)$$, (select value from ids where key = 'ceo_example')),
  'admin deletes an example');
select throws_ok(format($$select public.delete_writing_example(%L)$$, (select value from ids where key = 'ceo_example')),
  'P0002', null, 'deleting twice reports not found');
reset role;

-- ===========================================================================
-- A deactivated founder loses access
-- ===========================================================================
update public.profiles set status = 'deactivated' where user_id = '00000000-0000-4000-8000-0000000000c1';
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000c1","role":"authenticated","aal":"aal1"}', true);
select is_empty('select 1 from public.writing_examples', 'a deactivated founder reads no examples');
select throws_ok($$select public.add_writing_examples('00000000-0000-4000-8000-0000000000f1', '[{"body":"late"}]')$$,
  '42501', null, 'a deactivated founder cannot add examples');
reset role;

select * from finish();
rollback;
