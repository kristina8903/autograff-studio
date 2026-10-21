-- Phase 1 access-control tests (docs/PHASES.md Phase 1; docs/SECURITY.md §4).
-- Runs against the seeded local database with `npm run test:db`.
-- Every table gets: anon denied; founder A cannot reach founder B; founders
-- cannot reach admin-only tables; admins need MFA (aal2) for admin access.

begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

-- Seed ids
--   company  ...0001      admin a1, CEO c1 (founder f1), CTO c2 (founder f2), COO f3 (no login)
-- A second company, to prove the company boundary.
insert into public.companies (id, name, slug) values ('00000000-0000-4000-8000-000000000002', 'Other Co', 'other-co');
insert into public.settings (company_id, allowed_email_domains) values ('00000000-0000-4000-8000-000000000002', '{other.test}');
insert into auth.users (id, aud, role, email) values
  ('00000000-0000-4000-8000-0000000000b1', 'authenticated', 'authenticated', 'admin@other.test'),
  ('00000000-0000-4000-8000-0000000000d1', 'authenticated', 'authenticated', 'New-Founder@autograff.ai');
insert into public.profiles (user_id, company_id, role, status, email) values
  ('00000000-0000-4000-8000-0000000000b1', '00000000-0000-4000-8000-000000000002', 'admin', 'active', 'admin@other.test');
insert into public.founders (id, company_id, role_title, display_name) values
  ('00000000-0000-4000-8000-0000000000fb', '00000000-0000-4000-8000-000000000002', 'CEO', 'Other CEO');

-- ===========================================================================
-- anon: no table access at all
-- ===========================================================================
set local role anon;
select set_config('request.jwt.claims', '{"role":"anon"}', true);
select throws_ok('select * from public.companies', '42501', null, 'anon cannot read companies');
select throws_ok('select * from public.profiles', '42501', null, 'anon cannot read profiles');
select throws_ok('select * from public.founders', '42501', null, 'anon cannot read founders');
select throws_ok('select * from public.founder_visibility_grants', '42501', null, 'anon cannot read visibility grants');
select throws_ok('select * from public.settings', '42501', null, 'anon cannot read settings');
select throws_ok('select * from public.audit_events', '42501', null, 'anon cannot read audit events');
select throws_ok('select public.record_sign_in()', '42501', null, 'anon cannot call record_sign_in');
reset role;

-- ===========================================================================
-- Founder A (CEO, c1) vs founder B (CTO, c2)
-- ===========================================================================
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000c1","role":"authenticated","aal":"aal1"}', true);

select results_eq('select user_id::text from public.profiles', $$values ('00000000-0000-4000-8000-0000000000c1')$$,
  'founder sees only their own profile');
select results_eq('select id::text from public.founders', $$values ('00000000-0000-4000-8000-0000000000f1')$$,
  'founder sees only their own founder record');
select is_empty($$select 1 from public.founders where id = '00000000-0000-4000-8000-0000000000f2'$$,
  'founder A cannot read founder B');
select is_empty($$select 1 from public.profiles where user_id = '00000000-0000-4000-8000-0000000000c2'$$,
  'founder A cannot read founder B''s profile');
select results_eq($$with u as (update public.founders set display_name = 'hacked' where id = '00000000-0000-4000-8000-0000000000f2' returning 1) select count(*)::int from u$$,
  $$values (0)$$, 'founder A cannot update founder B');
select results_eq($$with u as (update public.founders set display_name = 'self-edit' where id = '00000000-0000-4000-8000-0000000000f1' returning 1) select count(*)::int from u$$,
  $$values (0)$$, 'founder cannot update founder records (admin-managed in Phase 1)');
select throws_ok($$insert into public.founders (company_id, role_title, display_name) values ('00000000-0000-4000-8000-000000000001', 'CMO', 'x')$$,
  '42501', null, 'founder cannot create founder records');
select results_eq($$with d as (delete from public.founders where id = '00000000-0000-4000-8000-0000000000f3' returning 1) select count(*)::int from d$$,
  $$values (0)$$, 'founder cannot delete founder records');
select throws_ok($$update public.profiles set role = 'admin' where user_id = '00000000-0000-4000-8000-0000000000c1'$$,
  '42501', null, 'founder cannot change their own role');
select throws_ok($$update public.profiles set status = 'active' where user_id = '00000000-0000-4000-8000-0000000000c1'$$,
  '42501', null, 'founder cannot change their own status');
select results_eq($$with u as (update public.profiles set display_name = 'CEO renamed' where user_id = '00000000-0000-4000-8000-0000000000c1' returning 1) select count(*)::int from u$$,
  $$values (1)$$, 'founder can update their own display name');
select results_eq($$with u as (update public.profiles set display_name = 'x' where user_id = '00000000-0000-4000-8000-0000000000c2' returning 1) select count(*)::int from u$$,
  $$values (0)$$, 'founder cannot update another user''s display name');
select is_empty('select 1 from public.settings', 'founder cannot read settings');
select is_empty('select 1 from public.audit_events', 'founder cannot read the audit log');
select is_empty('select 1 from public.founder_visibility_grants', 'founder cannot read visibility grants');
select throws_ok($$insert into public.audit_events (actor_kind, action) values ('user', 'fake.event')$$,
  '42501', null, 'founder cannot write audit events');
select throws_ok($$select public.admin_set_user_role('00000000-0000-4000-8000-0000000000c2', 'admin')$$,
  '42501', null, 'founder cannot change roles');
select throws_ok($$select public.admin_deactivate_user('00000000-0000-4000-8000-0000000000c2')$$,
  '42501', null, 'founder cannot deactivate users');
select throws_ok($$select public.provision_invited_user('00000000-0000-4000-8000-0000000000d1', 'founder', '00000000-0000-4000-8000-0000000000a1', '00000000-0000-4000-8000-0000000000f3')$$,
  '42501', null, 'founder cannot provision users');

-- A founder with an aal2 session is still only a founder.
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000c1","role":"authenticated","aal":"aal2"}', true);
select is_empty('select 1 from public.settings', 'founder with MFA still cannot read settings');
select results_eq('select count(*)::int from public.founders', $$values (1)$$, 'founder with MFA still sees one founder record');
reset role;

-- ===========================================================================
-- Admin without MFA (aal1): no admin access
-- ===========================================================================
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000a1","role":"authenticated","aal":"aal1"}', true);
select results_eq('select user_id::text from public.profiles', $$values ('00000000-0000-4000-8000-0000000000a1')$$,
  'admin without MFA sees only their own profile');
select is_empty('select 1 from public.founders', 'admin without MFA cannot read founders');
select is_empty('select 1 from public.settings', 'admin without MFA cannot read settings');
select throws_ok($$select public.admin_set_user_role('00000000-0000-4000-8000-0000000000c2', 'admin')$$,
  '42501', null, 'admin without MFA cannot change roles');
reset role;

-- ===========================================================================
-- Admin with MFA (aal2)
-- ===========================================================================
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000a1","role":"authenticated","aal":"aal2"}', true);
select results_eq('select count(*)::int from public.profiles', $$values (3)$$, 'admin sees all profiles in their company');
select results_eq('select count(*)::int from public.founders', $$values (3)$$, 'admin sees all founders in their company');
select is_empty($$select 1 from public.founders where company_id = '00000000-0000-4000-8000-000000000002'$$,
  'admin cannot read another company''s founders');
select is_empty($$select 1 from public.profiles where company_id = '00000000-0000-4000-8000-000000000002'$$,
  'admin cannot read another company''s profiles');
select results_eq('select count(*)::int from public.settings', $$values (1)$$, 'admin reads only their company settings');
select lives_ok($$insert into public.founders (company_id, role_title, display_name, timezone) values ('00000000-0000-4000-8000-000000000001', 'CMO', 'New CMO', 'Europe/London')$$,
  'admin can create a founder in their company');
select throws_ok($$insert into public.founders (company_id, role_title, display_name) values ('00000000-0000-4000-8000-000000000002', 'CMO', 'x')$$,
  '42501', null, 'admin cannot create a founder in another company');
select throws_ok($$insert into public.founders (company_id, role_title, display_name, user_id) values ('00000000-0000-4000-8000-000000000001', 'CMO', 'x', '00000000-0000-4000-8000-0000000000c2')$$,
  '42501', null, 'admin cannot link a login to a founder directly');
select throws_ok($$update public.founders set user_id = '00000000-0000-4000-8000-0000000000c2' where id = '00000000-0000-4000-8000-0000000000f3'$$,
  '42501', null, 'admin cannot relink a founder''s login directly');
select throws_ok($$update public.founders set timezone = 'Mars/Olympus' where id = '00000000-0000-4000-8000-0000000000f3'$$,
  '22023', null, 'invalid time zones are rejected');
select results_eq($$with u as (update public.founders set linkedin_profile_url = 'https://www.linkedin.com/in/someone' where id = '00000000-0000-4000-8000-0000000000f3' returning 1) select count(*)::int from u$$,
  $$values (1)$$, 'admin can edit a founder profile');
select throws_ok($$update public.founders set linkedin_profile_url = 'https://evil.example/in/x' where id = '00000000-0000-4000-8000-0000000000f3'$$,
  '23514', null, 'non-LinkedIn profile URLs are rejected');
select results_eq($$with d as (delete from public.founders where id = '00000000-0000-4000-8000-0000000000f1' returning 1) select count(*)::int from d$$,
  $$values (0)$$, 'admin cannot delete a founder that has a login');
select throws_ok($$select public.admin_set_user_role('00000000-0000-4000-8000-0000000000a1', 'founder')$$,
  '42501', null, 'admin cannot change their own role');
select throws_ok($$select public.admin_set_user_role('00000000-0000-4000-8000-0000000000b1', 'founder')$$,
  'P0002', null, 'admin cannot change roles in another company');
select lives_ok($$select public.admin_set_user_role('00000000-0000-4000-8000-0000000000c2', 'admin')$$,
  'admin can change another user''s role');
select results_eq($$select action, summary ->> 'to' from public.audit_events where entity_id = '00000000-0000-4000-8000-0000000000c2' and action = 'user.role_changed'$$,
  $$values ('user.role_changed', 'admin')$$, 'role change is audited');
select throws_ok($$insert into public.audit_events (actor_kind, action) values ('user', 'fake.event')$$,
  '42501', null, 'admin cannot write audit events directly');
select throws_ok($$update public.audit_events set action = 'x.y'$$, '42501', null, 'admin cannot edit audit events');
select throws_ok($$delete from public.audit_events$$, '42501', null, 'admin cannot delete audit events');
select throws_ok($$select public.admin_deactivate_user('00000000-0000-4000-8000-0000000000a1')$$,
  '42501', null, 'admin cannot deactivate themselves');
select lives_ok($$select public.admin_deactivate_user('00000000-0000-4000-8000-0000000000c1')$$,
  'admin can deactivate a founder');
select ok(exists(select 1 from public.audit_events where action = 'founder.updated'), 'founder edits are audited');
reset role;

-- ===========================================================================
-- A deactivated user loses access immediately, even with a valid token
-- ===========================================================================
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000c1","role":"authenticated","aal":"aal2"}', true);
select is_empty('select 1 from public.profiles', 'deactivated user cannot read their profile');
select is_empty('select 1 from public.founders', 'deactivated user cannot read their founder record');
select is_empty('select 1 from public.companies', 'deactivated user cannot read the company');
select throws_ok('select public.record_sign_in()', '42501', null, 'deactivated user cannot sign in');
reset role;

-- ===========================================================================
-- Audit log is append-only even for the database owner and service role
-- ===========================================================================
select throws_ok('delete from public.audit_events', '42501', null, 'audit events cannot be deleted by the owner');
select throws_ok($$update public.audit_events set action = 'x.y'$$, '42501', null, 'audit events cannot be edited by the owner');
set local role service_role;
select throws_ok($$insert into public.audit_events (actor_kind, action) values ('system', 'fake.event')$$,
  '42501', null, 'service role cannot write audit events directly');
reset role;

-- ===========================================================================
-- Email-domain hook (D-04)
-- ===========================================================================
select is(private.before_user_created('{"user":{"email":"someone@autograff.ai"}}'), '{}'::jsonb, 'autograff.ai addresses are allowed');
select is(private.before_user_created('{"user":{"email":"Someone@AutoGraff.AI"}}'), '{}'::jsonb, 'domain check is case-insensitive');
select ok(private.before_user_created('{"user":{"email":"someone@gmail.com"}}') ? 'error', 'other domains are rejected');
select ok(private.before_user_created('{"user":{"email":"a@autograff.ai.evil.com"}}') ? 'error', 'look-alike domains are rejected');
select ok(private.before_user_created('{"user":{"email":"a@evil.com@autograff.ai"}}') ? 'error', 'malformed addresses are rejected');
select ok(private.before_user_created('{"user":{}}') ? 'error', 'missing email is rejected');

-- The same rule holds on every insert into auth.users, whatever the path.
select throws_ok($$insert into auth.users (id, aud, role, email) values ('00000000-0000-4000-8000-0000000000d2', 'authenticated', 'authenticated', 'someone@gmail.com')$$,
  '42501', null, 'auth users with other domains cannot be created by any path');
select throws_ok($$update auth.users set email = 'someone@gmail.com' where id = '00000000-0000-4000-8000-0000000000c2'$$,
  '42501', null, 'an existing user''s email cannot be changed to another domain');

-- ===========================================================================
-- Invite provisioning (service role only)
-- ===========================================================================
set local role service_role;
select throws_ok($$select public.provision_invited_user('00000000-0000-4000-8000-0000000000d9', 'founder', '00000000-0000-4000-8000-0000000000a1', '00000000-0000-4000-8000-0000000000f3')$$,
  'P0002', null, 'cannot provision a user that does not exist in Auth');
select throws_ok($$select public.provision_invited_user('00000000-0000-4000-8000-0000000000d1', 'founder', '00000000-0000-4000-8000-0000000000c1', '00000000-0000-4000-8000-0000000000f3')$$,
  '42501', null, 'inviter must be an active admin (c1 is a deactivated founder)');
select throws_ok($$select public.provision_invited_user('00000000-0000-4000-8000-0000000000d1', 'founder', '00000000-0000-4000-8000-0000000000a1', null)$$,
  '22023', null, 'founder invite must name a founder record');
select throws_ok($$select public.provision_invited_user('00000000-0000-4000-8000-0000000000d1', 'founder', '00000000-0000-4000-8000-0000000000a1', '00000000-0000-4000-8000-0000000000fb')$$,
  'P0002', null, 'cannot link a founder record from another company');
select lives_ok($$select public.provision_invited_user('00000000-0000-4000-8000-0000000000d1', 'founder', '00000000-0000-4000-8000-0000000000a1', '00000000-0000-4000-8000-0000000000f3')$$,
  'admin invite provisions a founder');
reset role;
select results_eq($$select role::text, status::text, email from public.profiles where user_id = '00000000-0000-4000-8000-0000000000d1'$$,
  $$values ('founder', 'invited', 'new-founder@autograff.ai')$$, 'invited profile is a founder, status invited, email normalized');
select results_eq($$select user_id::text from public.founders where id = '00000000-0000-4000-8000-0000000000f3'$$,
  $$values ('00000000-0000-4000-8000-0000000000d1')$$, 'invite links the founder record');
select ok(exists(select 1 from public.audit_events where action = 'user.invited' and entity_id = '00000000-0000-4000-8000-0000000000d1'), 'invite is audited');

-- The invited founder signs in for the first time.
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000d1","role":"authenticated","aal":"aal1"}', true);
select is(public.record_sign_in()::text, 'active', 'first sign-in activates an invited user');
select results_eq('select id::text from public.founders', $$values ('00000000-0000-4000-8000-0000000000f3')$$,
  'the newly signed-in founder sees only their own founder record');
reset role;

select * from finish();
rollback;
