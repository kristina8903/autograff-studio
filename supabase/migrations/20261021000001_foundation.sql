-- Phase 1 foundation: company boundary, users and roles, founders, settings, audit.
-- See docs/DATA_MODEL.md §2, §11, §14 and docs/SECURITY.md §3–4.
--
-- Rules this migration establishes for every later one:
--   * RLS is enabled on every table; nothing is readable without a policy.
--   * `anon` has no table privileges at all.
--   * Status, role and audit changes go through SECURITY DEFINER functions with
--     search_path = '' that check the caller themselves.
--   * Helpers live in schema `private`, which PostgREST does not expose.

create schema if not exists private;
revoke all on schema private from public;
grant usage on schema private to authenticated, service_role;

-- anon never touches tables, now or in later migrations.
alter default privileges in schema public revoke all on tables from anon;
alter default privileges in schema public revoke all on sequences from anon;
alter default privileges in schema public revoke execute on functions from anon, public;

create type public.user_role as enum ('admin', 'founder');
create type public.user_status as enum ('invited', 'active', 'deactivated');
create type public.visibility_scope as enum ('calendar', 'approved_content', 'drafts');
create type public.actor_kind as enum ('user', 'system', 'job');

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

create table public.companies (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) > 0),
  slug text not null unique check (slug ~ '^[a-z0-9-]+$'),
  created_at timestamptz not null default now()
);

create table public.profiles (
  user_id uuid primary key references auth.users (id) on delete cascade,
  company_id uuid not null references public.companies (id),
  role public.user_role not null,
  status public.user_status not null default 'invited',
  display_name text not null default '' check (length(display_name) <= 120),
  email text not null check (email = lower(email)),
  invited_by uuid references public.profiles (user_id) on delete set null,
  activated_at timestamptz,
  deactivated_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, email)
);
create index profiles_company_idx on public.profiles (company_id);

create table public.founders (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id),
  user_id uuid unique references public.profiles (user_id) on delete set null,
  role_title text not null check (length(trim(role_title)) between 1 and 60),
  display_name text not null check (length(trim(display_name)) between 1 and 120),
  linkedin_profile_url text check (
    linkedin_profile_url is null
    or linkedin_profile_url ~ '^https://([a-z]{2,3}\.)?linkedin\.com/in/[^/?#\s]+/?$'
  ),
  timezone text not null default 'America/Los_Angeles',
  active boolean not null default true,
  created_by uuid references public.profiles (user_id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index founders_company_idx on public.founders (company_id);

create table public.founder_visibility_grants (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id),
  grantee_founder_id uuid not null references public.founders (id) on delete cascade,
  subject_founder_id uuid not null references public.founders (id) on delete cascade,
  scope public.visibility_scope not null,
  granted_by uuid references public.profiles (user_id) on delete set null,
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  check (grantee_founder_id <> subject_founder_id),
  unique (grantee_founder_id, subject_founder_id, scope)
);
create index founder_visibility_grants_subject_idx
  on public.founder_visibility_grants (subject_founder_id);

create table public.settings (
  company_id uuid primary key references public.companies (id) on delete cascade,
  allowed_email_domains text[] not null default '{autograff.ai}'
    check (cardinality(allowed_email_domains) > 0),
  updated_by uuid references public.profiles (user_id) on delete set null,
  updated_at timestamptz not null default now()
);

create table public.audit_events (
  id bigint generated always as identity primary key,
  company_id uuid references public.companies (id),
  occurred_at timestamptz not null default now(),
  actor_user_id uuid,
  actor_kind public.actor_kind not null,
  action text not null check (action ~ '^[a-z_]+\.[a-z_.]+$'),
  entity_type text,
  entity_id uuid,
  summary jsonb not null default '{}'::jsonb
);
create index audit_events_entity_idx on public.audit_events (entity_type, entity_id, occurred_at);
create index audit_events_company_time_idx on public.audit_events (company_id, occurred_at desc);

-- ---------------------------------------------------------------------------
-- Generic triggers
-- ---------------------------------------------------------------------------

create function private.touch_updated_at() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger profiles_touch before update on public.profiles
  for each row execute function private.touch_updated_at();
create trigger founders_touch before update on public.founders
  for each row execute function private.touch_updated_at();
create trigger settings_touch before update on public.settings
  for each row execute function private.touch_updated_at();

-- Founders' time zone must be a real IANA zone.
create function private.validate_founder() returns trigger
language plpgsql set search_path = '' as $$
begin
  if not exists (select 1 from pg_catalog.pg_timezone_names where name = new.timezone) then
    raise exception 'invalid time zone: %', new.timezone using errcode = '22023';
  end if;
  return new;
end;
$$;
create trigger founders_validate before insert or update on public.founders
  for each row execute function private.validate_founder();

-- Audit events are append-only for every role, including service_role.
create function private.reject_change() returns trigger
language plpgsql set search_path = '' as $$
begin
  raise exception '% is append-only', tg_table_name using errcode = '42501';
end;
$$;
create trigger audit_events_append_only before update or delete on public.audit_events
  for each row execute function private.reject_change();
create trigger audit_events_no_truncate before truncate on public.audit_events
  for each statement execute function private.reject_change();

-- ---------------------------------------------------------------------------
-- Identity helpers (used by policies and functions)
-- ---------------------------------------------------------------------------

-- The caller's active profile, or nothing. Deactivated users get nothing, which
-- makes every policy below fail for them immediately.
create function private.current_company_id() returns uuid
language sql stable security definer set search_path = '' as $$
  select p.company_id from public.profiles p
  where p.user_id = auth.uid() and p.status <> 'deactivated';
$$;

-- Admin privileges require the admin role, an active account and a session
-- that has passed MFA (aal2). docs/SECURITY.md §3.
create function private.is_admin() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.profiles p
    where p.user_id = auth.uid()
      and p.role = 'admin'
      and p.status = 'active'
  ) and coalesce(auth.jwt() ->> 'aal', '') = 'aal2';
$$;

create function private.current_founder_id() returns uuid
language sql stable security definer set search_path = '' as $$
  select f.id from public.founders f
  join public.profiles p on p.user_id = f.user_id
  where f.user_id = auth.uid() and p.status <> 'deactivated';
$$;

create function private.email_domain_allowed(p_email text) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.settings s
    where lower(split_part(p_email, '@', 2)) = any (s.allowed_email_domains)
      and p_email ~ '^[^@\s]+@[^@\s]+$'
  );
$$;

create function private.log_event(
  p_company_id uuid,
  p_action text,
  p_entity_type text,
  p_entity_id uuid,
  p_summary jsonb default '{}'::jsonb,
  p_actor_kind public.actor_kind default 'user'
) returns void
language sql security definer set search_path = '' as $$
  insert into public.audit_events (company_id, actor_user_id, actor_kind, action, entity_type, entity_id, summary)
  values (p_company_id, auth.uid(), p_actor_kind, p_action, p_entity_type, p_entity_id, coalesce(p_summary, '{}'::jsonb));
$$;

revoke all on all functions in schema private from public, anon;
grant execute on function
  private.current_company_id(),
  private.is_admin(),
  private.current_founder_id()
to authenticated;

-- ---------------------------------------------------------------------------
-- Auth hook: only allowed email domains may become users (docs/DECISIONS.md D-04)
-- ---------------------------------------------------------------------------

create function private.before_user_created(event jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_email text := lower(coalesce(event -> 'user' ->> 'email', ''));
begin
  if not private.email_domain_allowed(v_email) then
    return jsonb_build_object(
      'error', jsonb_build_object('http_code', 403, 'message', 'This email address cannot be used for Content Studio.')
    );
  end if;
  return '{}'::jsonb;
end;
$$;
-- The hook covers sign-up and invite paths but not the Auth admin "create user"
-- endpoint (verified locally 2026-10-21). This trigger enforces the same rule on
-- every insert into auth.users, whatever the path.
create function private.reject_disallowed_auth_user() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if not private.email_domain_allowed(lower(coalesce(new.email, ''))) then
    raise exception 'This email address cannot be used for Content Studio.' using errcode = '42501';
  end if;
  return new;
end;
$$;
create trigger auth_users_allowed_domain before insert or update of email on auth.users
  for each row execute function private.reject_disallowed_auth_user();

grant usage on schema private to supabase_auth_admin;
grant execute on function private.before_user_created(jsonb) to supabase_auth_admin;
grant execute on function private.email_domain_allowed(text) to supabase_auth_admin;

-- ---------------------------------------------------------------------------
-- Privileges and row-level security
-- ---------------------------------------------------------------------------

revoke all on all tables in schema public from anon;

alter table public.companies enable row level security;
alter table public.profiles enable row level security;
alter table public.founders enable row level security;
alter table public.founder_visibility_grants enable row level security;
alter table public.settings enable row level security;
alter table public.audit_events enable row level security;

-- companies: members read their own company.
revoke insert, update, delete on public.companies from authenticated;
create policy companies_select on public.companies for select to authenticated
  using (id = private.current_company_id());

-- profiles: everyone reads their own active row; admins read their company.
-- Only display_name is updatable by the user; role and status change through
-- the admin functions below. Rows are created only by provision_invited_user.
revoke insert, update, delete on public.profiles from authenticated;
grant update (display_name) on public.profiles to authenticated;
create policy profiles_select on public.profiles for select to authenticated
  using (
    (user_id = auth.uid() and status <> 'deactivated')
    or (private.is_admin() and company_id = private.current_company_id())
  );
create policy profiles_update_own on public.profiles for update to authenticated
  using (user_id = auth.uid() and status <> 'deactivated')
  with check (user_id = auth.uid());

-- founders: admins manage their company's founders; a founder reads their own.
-- Linking a founder to a login (user_id) happens only through
-- provision_invited_user, so the column is not writable by any API role.
revoke update on public.founders from authenticated;
grant update (role_title, display_name, linkedin_profile_url, timezone, active) on public.founders to authenticated;
create policy founders_select on public.founders for select to authenticated
  using (
    (private.is_admin() and company_id = private.current_company_id())
    or id = private.current_founder_id()
  );
create policy founders_insert on public.founders for insert to authenticated
  with check (private.is_admin() and company_id = private.current_company_id() and user_id is null);
create policy founders_update on public.founders for update to authenticated
  using (private.is_admin() and company_id = private.current_company_id())
  with check (company_id = private.current_company_id());
create policy founders_delete on public.founders for delete to authenticated
  using (private.is_admin() and company_id = private.current_company_id() and user_id is null);

-- founder_visibility_grants: admin only (no grants are issued in the MVP, D-13).
create policy grants_admin on public.founder_visibility_grants for all to authenticated
  using (private.is_admin() and company_id = private.current_company_id())
  with check (private.is_admin() and company_id = private.current_company_id());

-- settings: admin only.
revoke insert, delete on public.settings from authenticated;
create policy settings_select on public.settings for select to authenticated
  using (private.is_admin() and company_id = private.current_company_id());
create policy settings_update on public.settings for update to authenticated
  using (private.is_admin() and company_id = private.current_company_id())
  with check (company_id = private.current_company_id());

-- audit_events: admins read their company's events; nobody writes directly.
revoke insert, update, delete, truncate on public.audit_events from authenticated, service_role;
create policy audit_select on public.audit_events for select to authenticated
  using (private.is_admin() and company_id = private.current_company_id());

-- ---------------------------------------------------------------------------
-- Functions callable through the API
-- ---------------------------------------------------------------------------

-- Called by the server after every successful sign-in. Activates an invited
-- profile on first sign-in and records the event.
create function public.record_sign_in() returns public.user_status
language plpgsql security definer set search_path = '' as $$
declare
  v_profile public.profiles;
begin
  select * into v_profile from public.profiles where user_id = auth.uid() for update;
  if not found or v_profile.status = 'deactivated' then
    raise exception 'no active account' using errcode = '42501';
  end if;
  if v_profile.status = 'invited' then
    update public.profiles set status = 'active', activated_at = now() where user_id = v_profile.user_id;
    perform private.log_event(v_profile.company_id, 'user.activated', 'profile', v_profile.user_id);
  end if;
  perform private.log_event(v_profile.company_id, 'auth.sign_in', 'profile', v_profile.user_id);
  return 'active';
end;
$$;

create function public.admin_set_user_role(p_user_id uuid, p_role public.user_role) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_old public.user_role;
begin
  if not private.is_admin() then
    raise exception 'admin only' using errcode = '42501';
  end if;
  if p_user_id = auth.uid() then
    raise exception 'you cannot change your own role' using errcode = '42501';
  end if;
  select role into v_old from public.profiles
  where user_id = p_user_id and company_id = private.current_company_id()
  for update;
  if not found then
    raise exception 'user not found' using errcode = 'P0002';
  end if;
  if v_old = p_role then
    return;
  end if;
  update public.profiles set role = p_role where user_id = p_user_id;
  perform private.log_event(private.current_company_id(), 'user.role_changed', 'profile', p_user_id,
    jsonb_build_object('from', v_old, 'to', p_role));
end;
$$;

create function public.admin_deactivate_user(p_user_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_company uuid := private.current_company_id();
begin
  if not private.is_admin() then
    raise exception 'admin only' using errcode = '42501';
  end if;
  if p_user_id = auth.uid() then
    raise exception 'you cannot deactivate yourself' using errcode = '42501';
  end if;
  update public.profiles
     set status = 'deactivated', deactivated_at = now()
   where user_id = p_user_id and company_id = v_company and status <> 'deactivated';
  if not found then
    raise exception 'user not found or already deactivated' using errcode = 'P0002';
  end if;
  perform private.log_event(v_company, 'user.deactivated', 'profile', p_user_id);
end;
$$;

-- Service-role only: creates the profile for a user the admin just invited
-- through the Auth admin API, and optionally links them to a founder record.
create function public.provision_invited_user(
  p_user_id uuid,
  p_role public.user_role,
  p_invited_by uuid,
  p_founder_id uuid default null
) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_company uuid;
  v_email text;
begin
  -- The email comes from Auth itself, never from the caller.
  select lower(email) into v_email from auth.users where id = p_user_id;
  if v_email is null then
    raise exception 'auth user not found' using errcode = 'P0002';
  end if;
  select company_id into v_company from public.profiles
  where user_id = p_invited_by and role = 'admin' and status = 'active';
  if v_company is null then
    raise exception 'inviter is not an active admin' using errcode = '42501';
  end if;
  if not private.email_domain_allowed(v_email) then
    raise exception 'email domain not allowed' using errcode = '42501';
  end if;
  if p_role = 'founder' and p_founder_id is null then
    raise exception 'a founder invite must name the founder record' using errcode = '22023';
  end if;
  if p_role = 'admin' and p_founder_id is not null then
    raise exception 'an admin invite cannot link a founder record' using errcode = '22023';
  end if;

  insert into public.profiles (user_id, company_id, role, status, email, invited_by)
  values (p_user_id, v_company, p_role, 'invited', v_email, p_invited_by);

  if p_founder_id is not null then
    update public.founders set user_id = p_user_id
     where id = p_founder_id and company_id = v_company and user_id is null;
    if not found then
      raise exception 'founder not found or already linked' using errcode = 'P0002';
    end if;
  end if;

  insert into public.audit_events (company_id, actor_user_id, actor_kind, action, entity_type, entity_id, summary)
  values (v_company, p_invited_by, 'user', 'user.invited', 'profile', p_user_id,
          jsonb_build_object('role', p_role, 'founder_id', p_founder_id));
end;
$$;

-- Records admin edits to founder profiles (the edit itself goes through RLS).
create function private.audit_founder_change() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  perform private.log_event(new.company_id,
    case when tg_op = 'INSERT' then 'founder.created' else 'founder.updated' end,
    'founder', new.id,
    case when tg_op = 'INSERT' then jsonb_build_object('role_title', new.role_title)
         else jsonb_build_object('fields', (
           select coalesce(jsonb_agg(k), '[]'::jsonb) from jsonb_each(to_jsonb(new)) n(k, v)
           where k not in ('updated_at') and v is distinct from to_jsonb(old) -> k))
    end);
  return new;
end;
$$;
create trigger founders_audit after insert or update on public.founders
  for each row execute function private.audit_founder_change();

revoke all on function public.record_sign_in() from public, anon;
revoke all on function public.admin_set_user_role(uuid, public.user_role) from public, anon;
revoke all on function public.admin_deactivate_user(uuid) from public, anon;
revoke all on function public.provision_invited_user(uuid, public.user_role, uuid, uuid) from public, anon, authenticated;
grant execute on function public.record_sign_in() to authenticated;
grant execute on function public.admin_set_user_role(uuid, public.user_role) to authenticated;
grant execute on function public.admin_deactivate_user(uuid) to authenticated;
grant execute on function public.provision_invited_user(uuid, public.user_role, uuid, uuid) to service_role;
