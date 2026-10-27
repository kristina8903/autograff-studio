-- Phase 8 tests: coverage counts every draft exactly once, never counts
-- excluded, external, pending or repeated content as supply, follows an
-- invalidated approval at once, and is admin-only and read-only.

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
create function pg_temp.as_admin() returns void language sql as $$
  select set_config('role', 'authenticated', true);
  select pg_temp.as_user('00000000-0000-4000-8000-0000000000a1', 'aal2');
$$;

-- A draft for the CEO from its own selected concept, written by the runner.
-- p_share: shared with the founder; p_approve: and approved by them.
create function pg_temp.draft(p_key text, p_share boolean, p_approve boolean) returns uuid language plpgsql as $$
declare
  v_concept uuid;
  v_run uuid;
  v_version uuid;
  v_draft uuid;
begin
  insert into public.concepts (company_id, founder_id, target_month, brief_version_id, title, core_argument, format, status)
  values ('00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-0000000000f1', '2026-11-01',
    '00000000-0000-4000-8000-0000000000b1', 'Concept ' || p_key, 'Argument ' || p_key, 'story', 'selected')
  returning id into v_concept;
  perform pg_temp.as_admin();
  select run_id into v_run from public.request_generation('draft', '00000000-0000-4000-8000-0000000000f1', '2026-11-01',
    'fake', 'claude-opus-5-5', 'draft', 2,
    '{"brief_version_id": "00000000-0000-4000-8000-0000000000b1", "voice_profile_version_id": null, "example_ids": []}',
    jsonb_build_object('concept_id', v_concept), 0.4, 'pipeline-key-' || p_key);
  perform set_config('role', 'service_role', true);
  perform public.claim_generation_run(v_run);
  v_version := public.complete_draft_run(v_run, 'claude-opus-5-5', '{}', jsonb_build_object(
    'body', E'Post ' || p_key || E'.\n\nSecond paragraph.', 'alternative_hooks', jsonb_build_array('An opening.', 'Another.'),
    'rationale', 'r', 'fingerprint', '{}'::jsonb, 'claims', '[]'::jsonb, 'flags', '[]'::jsonb, 'checks', '[]'::jsonb));
  select draft_id into v_draft from public.draft_versions where id = v_version;
  if p_share then
    perform pg_temp.as_admin();
    perform public.share_draft(v_draft, '{}');
  end if;
  if p_approve then
    perform set_config('role', 'authenticated', true);
    perform pg_temp.as_user('00000000-0000-4000-8000-0000000000c1');
    perform public.approve_draft(v_draft, v_version, '');
  end if;
  perform set_config('role', 'postgres', true);
  insert into ids values (p_key, v_draft);
  return v_draft;
end;
$$;

-- An open (or overridden) repetition warning on the draft's current version.
create function pg_temp.repetition(p_draft uuid, p_type text, p_compared uuid, p_status public.flag_status) returns void
language sql as $$
  insert into public.review_flags (draft_version_id, company_id, kind, severity, source, message, compared_type,
    compared_id, status, resolved_at, resolution_note)
  select current_version_id, company_id, 'repetition', 'warning', 'repetition', 'Repeats something', p_type,
    p_compared, p_status, case when p_status = 'open' then null else now() end,
    case when p_status = 'open' then null else 'Deliberate follow-up' end
  from public.drafts where id = p_draft;
$$;

-- CEO slots in November: two open planned slots and one kept for news.
insert into public.calendar_slots (id, company_id, founder_id, slot_date, ordinal, kind, status) values
  ('00000000-0000-4000-8000-00000000520a', '00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-0000000000f1', '2026-11-10', 9, 'manual', 'open'),
  ('00000000-0000-4000-8000-00000000520b', '00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-0000000000f1', '2026-11-12', 9, 'manual', 'open'),
  ('00000000-0000-4000-8000-00000000520c', '00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-0000000000f1', '2026-11-03', 9, 'reserved_timely', 'open'),
  ('00000000-0000-4000-8000-00000000520d', '00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-0000000000f1', '2026-11-14', 9, 'manual', 'skipped');
update public.calendar_slots set cadence_rule_id = (select id from public.cadence_rules where founder_id = '00000000-0000-4000-8000-0000000000f1')
where id = '00000000-0000-4000-8000-00000000520c';

-- ===========================================================================
-- A draft in every state (criterion 1)
-- ===========================================================================
select pg_temp.draft('admin', false, false);                      -- admin review
select pg_temp.draft('drafting', false, false);
update public.drafts set status = 'drafting' where id = pg_temp.id('drafting');
select pg_temp.draft('changes', true, false);
update public.drafts set status = 'changes_requested' where id = pg_temp.id('changes');
select pg_temp.draft('review', true, false);                      -- founder review
select pg_temp.draft('approved', true, true);                     -- buffer
select pg_temp.draft('published', true, true);
select pg_temp.as_admin();
select public.record_publication(pg_temp.id('published'), now() - interval '1 hour', 'https://www.linkedin.com/posts/pipeline-1', null);
reset role;
select pg_temp.draft('repeat_post', true, true);                  -- repeats a published LinkedIn post
select pg_temp.repetition(pg_temp.id('repeat_post'), 'published_post',
  (select id from public.writing_examples where kind = 'published_linkedin' limit 1), 'open');
select pg_temp.draft('repeat_draft', true, true);                 -- repeats the published studio draft
select pg_temp.repetition(pg_temp.id('repeat_draft'), 'draft', pg_temp.id('published'), 'open');
select pg_temp.draft('repeat_ok', true, true);                    -- overridden with a reason: usable again
select pg_temp.repetition(pg_temp.id('repeat_ok'), 'published_post',
  (select id from public.writing_examples where kind = 'published_linkedin' limit 1), 'overridden');
select pg_temp.draft('overlap_live', true, true);                 -- overlaps a draft that is not published: usable
select pg_temp.repetition(pg_temp.id('overlap_live'), 'draft', pg_temp.id('admin'), 'open');
select pg_temp.draft('scheduled', true, true);
select pg_temp.draft('later', true, true);
select pg_temp.as_admin();
select public.schedule_draft(pg_temp.id('scheduled'), '2026-11-10 09:00-08', '00000000-0000-4000-8000-00000000520a');
select public.schedule_draft(pg_temp.id('later'), '2027-01-12 09:00-08', null);
select public.record_external_publication('00000000-0000-4000-8000-0000000000f1', now() - interval '2 hours',
  'https://www.linkedin.com/posts/pipeline-external', 'Posted outside the studio.');
reset role;
-- "approved" with no valid approval: a direct write by the owner.
select pg_temp.draft('forged', true, false);
update public.drafts set status = 'approved' where id = pg_temp.id('forged');
select pg_temp.draft('rejected', false, false);
update public.drafts set status = 'rejected' where id = pg_temp.id('rejected');
select pg_temp.draft('archived', false, false);
update public.drafts set status = 'archived' where id = pg_temp.id('archived');
select pg_temp.draft('external', false, false);
update public.drafts set is_external = true where id = pg_temp.id('external');
-- A selected concept with no draft is waiting; one whose only draft was rejected is not live.
insert into public.concepts (company_id, founder_id, target_month, brief_version_id, title, core_argument, format, status)
values ('00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-0000000000f1', '2026-11-01',
  '00000000-0000-4000-8000-0000000000b1', 'Waiting concept', 'Waiting', 'story', 'selected');
update public.concepts set status = 'selected'
where id = (select concept_id from public.drafts where id = pg_temp.id('rejected'));

-- The October–November period, as the admin.
select pg_temp.as_admin();
create temporary table buckets as
  select * from public.coverage_draft_buckets('00000000-0000-4000-8000-0000000000f1', '2026-10-01', '2026-12-01');
create temporary table cov as
  select * from public.coverage('00000000-0000-4000-8000-0000000000f1', '2026-10-01', '2026-12-01', '2026-10-27');
reset role;

select is((select count(*) from buckets)::integer, (select count(*) from public.drafts where founder_id = '00000000-0000-4000-8000-0000000000f1')::integer,
  'every draft of the founder has a row');
select is((select count(distinct draft_id) from buckets)::integer, (select count(*) from buckets)::integer,
  'and exactly one bucket');
select results_eq(
  $$select key, bucket from buckets join ids on ids.value = buckets.draft_id order by key$$,
  $$values ('admin', 'admin_review'), ('approved', 'approved_unscheduled'), ('archived', 'excluded'),
      ('changes', 'admin_review'), ('drafting', 'admin_review'), ('external', 'external'), ('forged', 'approval_invalid'),
      ('later', 'scheduled_other_period'), ('overlap_live', 'approved_unscheduled'), ('published', 'published'),
      ('rejected', 'excluded'), ('repeat_draft', 'held_repeat'), ('repeat_ok', 'approved_unscheduled'),
      ('repeat_post', 'held_repeat'), ('review', 'founder_review'), ('scheduled', 'scheduled')$$,
  'each state lands in its bucket');

select results_eq(
  $$select slots_required, slots_reserved_timely, slots_open, slots_filled, slots_skipped from cov$$,
  $$values (3, 1, 2, 1, 1)$$, 'slots in the period: the skipped one is not required');
select is((select published from cov), 2, 'publications in the period: the studio post and the external one');
select is((select scheduled from cov), 1, 'scheduled: only the one dated in the period');
select is((select approved_unscheduled from cov), 3,
  'usable buffer: approved, valid, not repeating published content (an overridden warning is usable)');
select is((select in_founder_review from cov), 1, 'founder review is pipeline');
select is((select in_admin_review from cov), 3, 'drafting, admin review and changes requested are pipeline');
select is((select concepts_waiting from cov), 2,
  'selected concepts with no live draft are waiting: one never drafted, one whose only draft was rejected');
select results_eq(
  $$select scheduled_other_period, held_repeat, approval_invalid, published_drafts, external_drafts, excluded from cov$$,
  $$values (1, 2, 1, 1, 1, 2)$$, 'the rest is shown apart and never counted as supply');
select is((select next_open_slot from cov), '2026-11-12'::date,
  'next open slot: the filled one and the slot kept for news are skipped');
select is((select scheduled + approved_unscheduled from cov), 4,
  'supply is scheduled plus the usable buffer, nothing else');

-- ===========================================================================
-- Invalidating a scheduled draft's approval changes coverage at once (criterion 2)
-- ===========================================================================
select pg_temp.as_admin();
select public.save_draft_version(pg_temp.id('scheduled'), E'An edited post.\n\nSecond paragraph.', '{"An opening.","Another."}',
  null, 'edit after scheduling', '[]', '[]');
create temporary table after_edit as
  select * from public.coverage('00000000-0000-4000-8000-0000000000f1', '2026-10-01', '2026-12-01', '2026-10-27');
reset role;
select is((select scheduled from after_edit), (select scheduled - 1 from cov), 'scheduled −1');
select is((select slots_open from after_edit), (select slots_open + 1 from cov), 'its slot is open again');
select is((select status::text from public.calendar_slots where id = '00000000-0000-4000-8000-00000000520a'), 'open', 'the slot row is open');
select is((select approved_unscheduled from after_edit), (select approved_unscheduled from cov), 'and it does not move into the buffer');
select is((select in_admin_review + in_founder_review from after_edit), (select in_admin_review + in_founder_review + 1 from cov),
  'it is back in review: pipeline, not supply');
select is((select next_open_slot from after_edit), '2026-11-10'::date, 'the freed slot is the next open slot');

-- ===========================================================================
-- Replenishment inputs (DATA_MODEL §12.4)
-- ===========================================================================
select pg_temp.as_admin();
select results_eq(
  $$select concepts_open, drafts_in_progress, scheduled_in_month, batch_size
    from public.candidate_supply('00000000-0000-4000-8000-0000000000f1', '2026-11-01')$$,
  -- In progress: admin, drafting, changes, review, and the edited draft.
  $$values (2, 5, 0, 5)$$, 'unused concepts, drafts in progress, scheduled in the month, and the batch ceiling');
select results_eq(
  $$select concepts_open, drafts_in_progress, scheduled_in_month from public.candidate_supply('00000000-0000-4000-8000-0000000000f1', '2027-01-01')$$,
  $$values (0, 0, 1)$$, 'per target month');
select throws_ok($$select * from public.candidate_supply('00000000-0000-4000-8000-0000000000f1', '2026-11-02')$$, '22023',
  'choose a month', 'a month starts on the 1st');
select throws_ok($$select * from public.coverage('00000000-0000-4000-8000-0000000000f1', '2026-11-01', '2026-11-01', '2026-10-27')$$,
  '22023', 'choose a period', 'an empty period is refused');
reset role;

-- ===========================================================================
-- Admin-only and read-only (criterion 4)
-- ===========================================================================
set local role anon;
select throws_ok($$select * from public.coverage('00000000-0000-4000-8000-0000000000f1', '2026-10-01', '2026-12-01', '2026-10-27')$$,
  '42501', null, 'anonymous is denied coverage');
select throws_ok($$select * from public.coverage_draft_buckets('00000000-0000-4000-8000-0000000000f1', '2026-10-01', '2026-12-01')$$,
  '42501', null, 'and the buckets');
select throws_ok($$select * from public.candidate_supply('00000000-0000-4000-8000-0000000000f1', '2026-11-01')$$,
  '42501', null, 'and replenishment inputs');
reset role;
set local role authenticated;
select pg_temp.as_user('00000000-0000-4000-8000-0000000000c1', 'aal2');
select throws_ok($$select * from public.coverage('00000000-0000-4000-8000-0000000000f1', '2026-10-01', '2026-12-01', '2026-10-27')$$,
  '42501', 'admin only', 'a founder cannot read coverage, even their own');
select throws_ok($$select * from public.coverage_draft_buckets('00000000-0000-4000-8000-0000000000f2', '2026-10-01', '2026-12-01')$$,
  '42501', 'admin only', 'nor another founder''s buckets');
select throws_ok($$select * from public.candidate_supply('00000000-0000-4000-8000-0000000000f1', '2026-11-01')$$,
  '42501', 'admin only', 'nor replenishment inputs');
select pg_temp.as_user('00000000-0000-4000-8000-0000000000a1', 'aal1');
select throws_ok($$select * from public.coverage('00000000-0000-4000-8000-0000000000f1', '2026-10-01', '2026-12-01', '2026-10-27')$$,
  '42501', 'admin only', 'an admin without MFA is denied');
select pg_temp.as_user('00000000-0000-4000-8000-0000000000a1', 'aal2');
select throws_ok($$select * from public.coverage('00000000-0000-4000-8000-0000000000ff', '2026-10-01', '2026-12-01', '2026-10-27')$$,
  'P0002', 'founder not found', 'an unknown founder is not found');
reset role;
select is(
  (select array_agg(distinct provolatile) from pg_proc
   where pronamespace = 'public'::regnamespace and proname in ('coverage', 'coverage_draft_buckets', 'candidate_supply')),
  array['s'::"char"], 'every coverage function is read-only (stable)');
select is((select count(*)::integer from public.audit_events where occurred_at > now() - interval '1 minute'
             and action like 'coverage%'), 0, 'reading coverage writes nothing');

select * from finish();
rollback;
