-- LOCAL DEVELOPMENT SEED ONLY. Applied by `supabase db reset` against the local
-- Docker stack. Never run against staging or production.
--
-- Creates a fake company, a local admin and three founder records (CEO and CTO
-- linked to logins, COO not yet invited). All local email is caught by the
-- local mail server (http://127.0.0.1:54324); nothing is delivered.
--
-- Sign in at http://localhost:3000/sign-in with one of these addresses and the
-- code from the local mail server:
--   local-admin@autograff.ai   (admin; enrolls an authenticator on first sign-in)
--   local-ceo@autograff.ai     (founder: CEO)
--   local-cto@autograff.ai     (founder: CTO)

insert into public.companies (id, name, slug)
values ('00000000-0000-4000-8000-000000000001', 'Autograff', 'autograff');

insert into public.settings (company_id, allowed_email_domains)
values ('00000000-0000-4000-8000-000000000001', '{autograff.ai}');

-- Auth users (direct inserts bypass the invite flow; local only).
insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, recovery_token, email_change_token_new, email_change,
  email_change_token_current, phone_change_token, reauthentication_token
)
select
  '00000000-0000-0000-0000-000000000000', u.id, 'authenticated', 'authenticated', u.email, '', now(),
  '{"provider":"email","providers":["email"]}', '{}', now(), now(),
  '', '', '', '', '', '', ''
from (values
  ('00000000-0000-4000-8000-0000000000a1'::uuid, 'local-admin@autograff.ai'),
  ('00000000-0000-4000-8000-0000000000c1'::uuid, 'local-ceo@autograff.ai'),
  ('00000000-0000-4000-8000-0000000000c2'::uuid, 'local-cto@autograff.ai')
) as u (id, email);

insert into auth.identities (id, provider_id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
select gen_random_uuid(), u.id::text, u.id,
       jsonb_build_object('sub', u.id::text, 'email', u.email, 'email_verified', true),
       'email', now(), now(), now()
from auth.users u
where u.email like 'local-%@autograff.ai';

insert into public.profiles (user_id, company_id, role, status, display_name, email, activated_at)
values
  ('00000000-0000-4000-8000-0000000000a1', '00000000-0000-4000-8000-000000000001', 'admin', 'active', 'Local Admin', 'local-admin@autograff.ai', now()),
  ('00000000-0000-4000-8000-0000000000c1', '00000000-0000-4000-8000-000000000001', 'founder', 'active', 'Local CEO', 'local-ceo@autograff.ai', now()),
  ('00000000-0000-4000-8000-0000000000c2', '00000000-0000-4000-8000-000000000001', 'founder', 'active', 'Local CTO', 'local-cto@autograff.ai', now());

insert into public.founders (id, company_id, user_id, role_title, display_name, timezone)
values
  ('00000000-0000-4000-8000-0000000000f1', '00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-0000000000c1', 'CEO', 'Local CEO', 'America/Los_Angeles'),
  ('00000000-0000-4000-8000-0000000000f2', '00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-0000000000c2', 'CTO', 'Local CTO', 'America/Los_Angeles'),
  ('00000000-0000-4000-8000-0000000000f3', '00000000-0000-4000-8000-000000000001', null, 'COO', 'Local COO', 'America/Los_Angeles');

-- Phase 2: default cadences (docs/PRODUCT_SPEC.md §2.3) as data, and a sample brief.
insert into public.cadence_rules (
  company_id, founder_id, effective_from, period, min_posts, max_posts, publishing_days,
  reserved_timely_slots_per_month, buffer_target, low_buffer_threshold, candidate_target_min, candidate_target_max, change_reason
) values
  ('00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-0000000000f1', '2026-01-01', 'week', 2, 3, '{2,3,4}', 1, 3, 2, 16, 20, 'Initial default'),
  ('00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-0000000000f2', '2026-01-01', 'month', 2, 2, '{2,3,4}', 0, 1, 1, 4, 6, 'Initial default'),
  ('00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-0000000000f3', '2026-01-01', 'week', 2, 3, '{2,3,4}', 1, 3, 2, 16, 20, 'Initial default');

insert into public.monthly_briefs (id, company_id, month, title)
values ('00000000-0000-4000-8000-0000000000b0', '00000000-0000-4000-8000-000000000001', '2026-11-01', 'November: operational uncertainty');
insert into public.brief_versions (id, brief_id, company_id, version_no, content, founder_emphasis, approved_facts, change_note)
values (
  '00000000-0000-4000-8000-0000000000b1', '00000000-0000-4000-8000-0000000000b0', '00000000-0000-4000-8000-000000000001', 1,
  '{"theme": "Operational uncertainty in vehicle repair", "secondaryThemes": [], "objectives": ["Show why repair status visibility matters"], "audiences": ["Fleet operations leads", "Independent shop owners"], "coreArguments": [], "productUpdates": [], "industryDevelopments": [], "contentMix": [], "topicsToAvoid": ["Naming competitors"], "callsToAction": [], "datesAndEvents": [], "previousThemesToAvoid": []}',
  '{"00000000-0000-4000-8000-0000000000f1": "Why software must help work progress, not just record it"}',
  '[]', 'Seed'
);
update public.monthly_briefs set current_version_id = '00000000-0000-4000-8000-0000000000b1' where id = '00000000-0000-4000-8000-0000000000b0';

-- Phase 3: a sample voice profile, writing examples and feedback signals.
-- All text is invented local test data, not any founder's real writing.
insert into public.voice_profiles (id, company_id, founder_id)
values ('00000000-0000-4000-8000-0000000000d0', '00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-0000000000f1');
insert into public.voice_profile_versions (
  id, profile_id, company_id, founder_id, version_no, attributes, preferred_phrases, avoid_phrases,
  expertise_topics, writing_habits, style_rules, format_preferences, notes, change_reason
) values (
  '00000000-0000-4000-8000-0000000000d1', '00000000-0000-4000-8000-0000000000d0', '00000000-0000-4000-8000-000000000001',
  '00000000-0000-4000-8000-0000000000f1', 1,
  '{"sentenceLength": "varied", "paragraphStyle": "Two to four sentences per paragraph", "humor": "light", "technicalDepth": "medium", "pointOfView": "First person, plain and direct"}',
  '{"Here is what we saw"}', '{"game-changer", "In today''s fast-paced world"}',
  '{"repair operations", "fleet maintenance"}', '{"Ends with a question to the reader"}',
  '{"No em-dashes"}', '{"story": "Open with the moment, not the lesson"}', '', 'Seed'
);
update public.voice_profiles set current_version_id = '00000000-0000-4000-8000-0000000000d1' where id = '00000000-0000-4000-8000-0000000000d0';

insert into public.writing_examples (company_id, founder_id, kind, body, source_url, published_at, format, topics, approved_for_voice, eval_holdout) values
  ('00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-0000000000f1', 'published_linkedin',
   'A fleet manager told me last week that the hardest part of a repair is not the repair. It is not knowing when the van comes back.',
   'https://www.linkedin.com/posts/local-ceo-example-1', '2026-09-15', 'story', '{repair status,fleet maintenance}', true, false),
  ('00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-0000000000f1', 'published_linkedin',
   'Three things every shop owner should track before buying software: cycle time, parts wait, and how often customers call to ask for updates.',
   'https://www.linkedin.com/posts/local-ceo-example-2', '2026-08-02', 'list', '{repair operations,software}', true, false),
  ('00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-0000000000f1', 'approved_example',
   'We used to think speed was the goal. It turns out predictability is what fleets pay for.',
   null, null, 'opinion', '{fleet maintenance}', true, true),
  ('00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-0000000000f1', 'other',
   'Draft notes, not for voice: pricing page ideas.', null, null, null, '{}', false, false),
  ('00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-0000000000f3', 'published_linkedin',
   'Shop-floor throughput improves when everyone can see the same board. Here is how our team set one up.',
   'https://www.linkedin.com/posts/local-coo-example-1', '2026-09-20', 'how_to', '{operations,repair operations}', true, false);

insert into public.feedback_signals (company_id, founder_id, kind, format, statement, proposed_by) values
  ('00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-0000000000f1', 'stable_preference', null, 'Never open with a question.', 'admin'),
  ('00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-0000000000f1', 'one_off', null, 'Shorten the second paragraph of the October post.', 'admin');
