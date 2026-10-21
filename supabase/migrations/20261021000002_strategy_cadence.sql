-- Phase 2: monthly briefs (versioned), founder cadence rules (effective-dated)
-- and calendar slots. See docs/PRODUCT_SPEC.md §3–4, docs/DATA_MODEL.md §3, §5, §12.
--
-- Slot dates are computed in TypeScript (lib/domain/cadence.ts) and applied
-- here by sync_calendar_slots(), which owns the rules about what may change:
-- past, filled, skipped and manual slots are never touched by planning.

create extension if not exists btree_gist with schema extensions;

create type public.cadence_period as enum ('week', 'month');
create type public.slot_kind as enum ('regular', 'reserved_timely', 'manual');
create type public.slot_status as enum ('open', 'filled', 'skipped');

-- ---------------------------------------------------------------------------
-- Monthly briefs
-- ---------------------------------------------------------------------------

create table public.monthly_briefs (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id),
  month date not null check (extract(day from month) = 1),
  title text not null default '' check (length(title) <= 200),
  current_version_id uuid,
  created_by uuid references public.profiles (user_id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, month)
);

create table public.brief_versions (
  id uuid primary key default gen_random_uuid(),
  brief_id uuid not null references public.monthly_briefs (id),
  company_id uuid not null references public.companies (id),
  version_no integer not null check (version_no > 0),
  content jsonb not null check (
    jsonb_typeof(content) = 'object' and length(trim(coalesce(content ->> 'theme', ''))) > 0
  ),
  founder_emphasis jsonb not null default '{}'::jsonb check (jsonb_typeof(founder_emphasis) = 'object'),
  approved_facts jsonb not null default '[]'::jsonb check (jsonb_typeof(approved_facts) = 'array'),
  change_note text not null default '' check (length(change_note) <= 500),
  created_by uuid references public.profiles (user_id) on delete set null,
  created_at timestamptz not null default now(),
  unique (brief_id, version_no)
);
create index brief_versions_brief_idx on public.brief_versions (brief_id, version_no desc);

alter table public.monthly_briefs
  add constraint monthly_briefs_current_version_fk
  foreign key (current_version_id) references public.brief_versions (id);

create trigger monthly_briefs_touch before update on public.monthly_briefs
  for each row execute function private.touch_updated_at();
-- Versions are immutable for every role.
create trigger brief_versions_immutable before update or delete on public.brief_versions
  for each row execute function private.reject_change();

-- ---------------------------------------------------------------------------
-- Cadence rules
-- ---------------------------------------------------------------------------

create table public.cadence_rules (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id),
  founder_id uuid not null references public.founders (id) on delete cascade,
  effective_from date not null,
  -- Exclusive: the first day the rule no longer applies.
  effective_to date check (effective_to is null or effective_to > effective_from),
  period public.cadence_period not null,
  min_posts smallint not null check (min_posts >= 1),
  max_posts smallint not null check (max_posts >= min_posts and max_posts <= 31),
  weekly_pattern smallint[] check (
    weekly_pattern is null or (period = 'week' and cardinality(weekly_pattern) between 1 and 12)
  ),
  publishing_days smallint[] not null check (
    cardinality(publishing_days) between 1 and 7 and publishing_days <@ '{1,2,3,4,5,6,7}'::smallint[]
  ),
  preferred_local_time time,
  reserved_timely_slots_per_month smallint not null default 0 check (reserved_timely_slots_per_month >= 0),
  buffer_target smallint not null default 0 check (buffer_target >= 0),
  low_buffer_threshold smallint not null default 0 check (low_buffer_threshold >= 0),
  candidate_target_min smallint not null default 0 check (candidate_target_min >= 0),
  candidate_target_max smallint not null default 0 check (candidate_target_max >= candidate_target_min),
  change_reason text not null default '' check (length(change_reason) <= 500),
  created_by uuid references public.profiles (user_id) on delete set null,
  created_at timestamptz not null default now(),
  check (period <> 'week' or max_posts <= cardinality(publishing_days)),
  constraint cadence_rules_no_overlap exclude using gist (
    founder_id with =,
    daterange(effective_from, effective_to, '[)') with &&
  )
);
create index cadence_rules_founder_idx on public.cadence_rules (founder_id, effective_from);

-- Checks a CHECK constraint can't express: distinct days, pattern within limits.
create function private.validate_cadence_rule() returns trigger
language plpgsql set search_path = '' as $$
begin
  if (select count(distinct d) from unnest(new.publishing_days) d) <> cardinality(new.publishing_days) then
    raise exception 'each publishing day can only be chosen once' using errcode = '23514';
  end if;
  if new.weekly_pattern is not null and exists (
    select 1 from unnest(new.weekly_pattern) n where n < new.min_posts or n > new.max_posts
  ) then
    raise exception 'each week in the pattern must be between the minimum and maximum' using errcode = '23514';
  end if;
  if not exists (select 1 from public.founders f where f.id = new.founder_id and f.company_id = new.company_id) then
    raise exception 'founder belongs to another company' using errcode = '23514';
  end if;
  return new;
end;
$$;
create trigger cadence_rules_validate before insert or update on public.cadence_rules
  for each row execute function private.validate_cadence_rule();

-- ---------------------------------------------------------------------------
-- Calendar slots
-- ---------------------------------------------------------------------------

create table public.calendar_slots (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id),
  founder_id uuid not null references public.founders (id) on delete cascade,
  -- A date in the founder's own calendar (time zone on public.founders).
  slot_date date not null,
  ordinal smallint not null default 0 check (ordinal >= 0),
  kind public.slot_kind not null,
  cadence_rule_id uuid references public.cadence_rules (id) on delete set null,
  status public.slot_status not null default 'open',
  -- References drafts from Phase 4; the foreign key is added with that table.
  draft_id uuid,
  note text not null default '' check (length(note) <= 500),
  created_by uuid references public.profiles (user_id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (founder_id, slot_date, ordinal),
  check (kind <> 'manual' or cadence_rule_id is null),
  check (status <> 'filled' or draft_id is not null)
);
create index calendar_slots_founder_date_idx on public.calendar_slots (founder_id, slot_date);

create trigger calendar_slots_touch before update on public.calendar_slots
  for each row execute function private.touch_updated_at();

-- ---------------------------------------------------------------------------
-- Privileges and row-level security
-- ---------------------------------------------------------------------------

alter table public.monthly_briefs enable row level security;
alter table public.brief_versions enable row level security;
alter table public.cadence_rules enable row level security;
alter table public.calendar_slots enable row level security;

-- All writes go through the functions below.
revoke insert, update, delete, truncate on
  public.monthly_briefs, public.brief_versions, public.cadence_rules, public.calendar_slots
from authenticated;

create policy briefs_admin_select on public.monthly_briefs for select to authenticated
  using (private.is_admin() and company_id = private.current_company_id());
create policy brief_versions_admin_select on public.brief_versions for select to authenticated
  using (private.is_admin() and company_id = private.current_company_id());

create policy cadence_select on public.cadence_rules for select to authenticated
  using (
    (private.is_admin() and company_id = private.current_company_id())
    or founder_id = private.current_founder_id()
  );

create policy slots_select on public.calendar_slots for select to authenticated
  using (
    (private.is_admin() and company_id = private.current_company_id())
    or founder_id = private.current_founder_id()
  );

-- ---------------------------------------------------------------------------
-- Functions
-- ---------------------------------------------------------------------------

create function private.require_admin() returns uuid
language plpgsql stable security definer set search_path = '' as $$
begin
  if not private.is_admin() then
    raise exception 'admin only' using errcode = '42501';
  end if;
  return private.current_company_id();
end;
$$;

create function private.require_founder_in_company(p_founder_id uuid, p_company uuid) returns void
language plpgsql stable security definer set search_path = '' as $$
begin
  if not exists (select 1 from public.founders where id = p_founder_id and company_id = p_company) then
    raise exception 'founder not found' using errcode = 'P0002';
  end if;
end;
$$;

-- "Today" as the server computed it in the founder's time zone, sanity-checked
-- against the database clock so it can't be used to rewrite the past.
create function private.check_today(p_today date) returns void
language plpgsql stable set search_path = '' as $$
begin
  if p_today is null or p_today < current_date - 1 or p_today > current_date + 1 then
    raise exception 'invalid today: %', p_today using errcode = '22023';
  end if;
end;
$$;

-- Saves the next version of a month's brief (creating the brief if needed).
create function public.save_brief_version(
  p_month date,
  p_title text,
  p_content jsonb,
  p_founder_emphasis jsonb,
  p_approved_facts jsonb,
  p_change_note text
) returns integer
language plpgsql security definer set search_path = '' as $$
declare
  v_company uuid := private.require_admin();
  v_brief uuid;
  v_no integer;
  v_version uuid;
begin
  if p_month is null or extract(day from p_month) <> 1 then
    raise exception 'month must be the first day of a month' using errcode = '22023';
  end if;
  if exists (
    select 1 from jsonb_object_keys(coalesce(p_founder_emphasis, '{}'::jsonb)) k
    where not exists (select 1 from public.founders f where f.id::text = k and f.company_id = v_company)
  ) then
    raise exception 'emphasis names an unknown founder' using errcode = '22023';
  end if;

  insert into public.monthly_briefs (company_id, month, title, created_by)
  values (v_company, p_month, coalesce(p_title, ''), auth.uid())
  on conflict (company_id, month) do update set title = excluded.title
  returning id into v_brief;

  perform 1 from public.monthly_briefs where id = v_brief for update;
  select coalesce(max(version_no), 0) + 1 into v_no from public.brief_versions where brief_id = v_brief;

  insert into public.brief_versions (brief_id, company_id, version_no, content, founder_emphasis, approved_facts, change_note, created_by)
  values (v_brief, v_company, v_no, p_content, coalesce(p_founder_emphasis, '{}'::jsonb),
          coalesce(p_approved_facts, '[]'::jsonb), coalesce(p_change_note, ''), auth.uid())
  returning id into v_version;

  update public.monthly_briefs set current_version_id = v_version where id = v_brief;
  perform private.log_event(v_company, 'brief.version_saved', 'monthly_brief', v_brief,
    jsonb_build_object('month', p_month, 'version', v_no));
  return v_no;
end;
$$;

-- A founder's view of a brief: the theme and their own emphasis only (D-13).
create function public.founder_brief(p_month date)
returns table (month date, version_no integer, theme text, emphasis text)
language sql stable security definer set search_path = '' as $$
  select b.month, v.version_no, v.content ->> 'theme', v.founder_emphasis ->> f.id::text
  from public.founders f
  join public.monthly_briefs b on b.company_id = f.company_id and b.month = p_month
  join public.brief_versions v on v.id = b.current_version_id
  where f.id = private.current_founder_id();
$$;

-- Starts a new cadence rule for a founder from p_effective_from. The previous
-- rule is closed the day before; nothing before that date changes.
create function public.set_cadence_rule(
  p_founder_id uuid,
  p_effective_from date,
  p_period public.cadence_period,
  p_min_posts integer,
  p_max_posts integer,
  p_weekly_pattern smallint[],
  p_publishing_days smallint[],
  p_reserved_timely integer,
  p_buffer_target integer,
  p_low_buffer_threshold integer,
  p_candidate_target_min integer,
  p_candidate_target_max integer,
  p_change_reason text,
  p_today date
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_company uuid := private.require_admin();
  v_latest public.cadence_rules;
  v_id uuid;
begin
  perform private.require_founder_in_company(p_founder_id, v_company);
  perform private.check_today(p_today);

  select * into v_latest from public.cadence_rules
  where founder_id = p_founder_id order by effective_from desc limit 1 for update;

  if found then
    if p_effective_from < p_today then
      raise exception 'a cadence change can only start today or later' using errcode = '22023';
    end if;
    if p_effective_from < v_latest.effective_from then
      raise exception 'a new rule must start on or after % (the current rule''s start)', v_latest.effective_from
        using errcode = '22023';
    elsif p_effective_from = v_latest.effective_from then
      -- Replacing a rule on its first day: only while none of its slots are used.
      if exists (select 1 from public.calendar_slots where cadence_rule_id = v_latest.id and status <> 'open') then
        raise exception 'this rule already has filled or skipped slots; start the change on a later date'
          using errcode = '22023';
      end if;
      delete from public.calendar_slots where cadence_rule_id = v_latest.id and status = 'open';
      delete from public.cadence_rules where id = v_latest.id;
    else
      update public.cadence_rules set effective_to = p_effective_from
      where id = v_latest.id and (effective_to is null or effective_to > p_effective_from);
    end if;
  end if;

  insert into public.cadence_rules (
    company_id, founder_id, effective_from, period, min_posts, max_posts, weekly_pattern, publishing_days,
    reserved_timely_slots_per_month, buffer_target, low_buffer_threshold, candidate_target_min,
    candidate_target_max, change_reason, created_by
  ) values (
    v_company, p_founder_id, p_effective_from, p_period, p_min_posts, p_max_posts, p_weekly_pattern,
    p_publishing_days, coalesce(p_reserved_timely, 0), coalesce(p_buffer_target, 0),
    coalesce(p_low_buffer_threshold, 0), coalesce(p_candidate_target_min, 0),
    coalesce(p_candidate_target_max, 0), coalesce(p_change_reason, ''), auth.uid()
  ) returning id into v_id;

  perform private.log_event(v_company, 'cadence.rule_set', 'founder', p_founder_id,
    jsonb_build_object('rule_id', v_id, 'effective_from', p_effective_from, 'period', p_period,
                       'min', p_min_posts, 'max', p_max_posts));
  return v_id;
end;
$$;

-- Applies planned slots for one founder and month. p_slots is the output of
-- generateSlots(): [{ "date": "2026-11-03", "kind": "regular", "rule_id": "…" }].
-- From max(month start, today) onward: open planned slots not in the plan are
-- removed and missing ones created. Past, filled, skipped and manual slots are
-- never touched; filled slots no longer in the plan are reported.
create function public.sync_calendar_slots(p_founder_id uuid, p_month date, p_slots jsonb, p_today date)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_company uuid := private.require_admin();
  v_from date;
  v_to date := (p_month + interval '1 month')::date;
  v_removed integer;
  v_created integer;
  v_outside jsonb;
begin
  perform private.require_founder_in_company(p_founder_id, v_company);
  perform private.check_today(p_today);
  if p_month is null or extract(day from p_month) <> 1 then
    raise exception 'month must be the first day of a month' using errcode = '22023';
  end if;
  if jsonb_typeof(p_slots) <> 'array' then
    raise exception 'slots must be an array' using errcode = '22023';
  end if;
  v_from := greatest(p_month, p_today);

  if exists (select 1 from (select (e ->> 'date')::date as slot_date, (e ->> 'kind')::public.slot_kind as kind, (e ->> 'rule_id')::uuid as rule_id
          from jsonb_array_elements(p_slots) e) d where d.slot_date < p_month or d.slot_date >= v_to) then
    raise exception 'a planned slot falls outside the month' using errcode = '22023';
  end if;
  if exists (select 1 from (select (e ->> 'date')::date as slot_date, (e ->> 'kind')::public.slot_kind as kind, (e ->> 'rule_id')::uuid as rule_id
          from jsonb_array_elements(p_slots) e) d where d.kind not in ('regular', 'reserved_timely')) then
    raise exception 'planned slots must be regular or reserved_timely' using errcode = '22023';
  end if;
  if exists (
    select 1 from (select (e ->> 'date')::date as slot_date, (e ->> 'kind')::public.slot_kind as kind, (e ->> 'rule_id')::uuid as rule_id
          from jsonb_array_elements(p_slots) e) d
    where not exists (
      select 1 from public.cadence_rules r
      where r.id = d.rule_id and r.founder_id = p_founder_id
        and d.slot_date >= r.effective_from and (r.effective_to is null or d.slot_date < r.effective_to)
    )
  ) then
    raise exception 'a planned slot does not match a cadence rule in effect on its date' using errcode = '22023';
  end if;
  if (select count(*) from jsonb_array_elements(p_slots)) <> (select count(distinct (e ->> 'date')) from jsonb_array_elements(p_slots) e) then
    raise exception 'a date is planned twice' using errcode = '22023';
  end if;

  delete from public.calendar_slots c
  where c.founder_id = p_founder_id
    and c.slot_date >= v_from and c.slot_date < v_to
    and c.status = 'open' and c.kind in ('regular', 'reserved_timely')
    and not exists (
      select 1 from (select (e ->> 'date')::date as slot_date, (e ->> 'kind')::public.slot_kind as kind, (e ->> 'rule_id')::uuid as rule_id
          from jsonb_array_elements(p_slots) e) d
      where d.slot_date = c.slot_date and d.kind = c.kind and d.rule_id is not distinct from c.cadence_rule_id
    );
  get diagnostics v_removed = row_count;

  insert into public.calendar_slots (company_id, founder_id, slot_date, ordinal, kind, cadence_rule_id, created_by)
  select v_company, p_founder_id, d.slot_date, 0, d.kind, d.rule_id, auth.uid()
  from (select (e ->> 'date')::date as slot_date, (e ->> 'kind')::public.slot_kind as kind, (e ->> 'rule_id')::uuid as rule_id
          from jsonb_array_elements(p_slots) e) d
  where d.slot_date >= v_from
    and not exists (select 1 from public.calendar_slots c where c.founder_id = p_founder_id and c.slot_date = d.slot_date);
  get diagnostics v_created = row_count;

  select coalesce(jsonb_agg(c.slot_date order by c.slot_date), '[]'::jsonb) into v_outside
  from public.calendar_slots c
  where c.founder_id = p_founder_id and c.slot_date >= v_from and c.slot_date < v_to
    and c.status = 'filled' and c.kind <> 'manual'
    and not exists (select 1 from (select (e ->> 'date')::date as slot_date, (e ->> 'kind')::public.slot_kind as kind, (e ->> 'rule_id')::uuid as rule_id
          from jsonb_array_elements(p_slots) e) d where d.slot_date = c.slot_date);

  if v_removed > 0 or v_created > 0 then
    perform private.log_event(v_company, 'calendar.planned', 'founder', p_founder_id,
      jsonb_build_object('month', p_month, 'created', v_created, 'removed', v_removed));
  end if;
  return jsonb_build_object('created', v_created, 'removed', v_removed, 'outside_cadence', v_outside);
end;
$$;

create function public.add_manual_slot(p_founder_id uuid, p_date date, p_note text, p_today date) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_company uuid := private.require_admin();
  v_id uuid;
begin
  perform private.require_founder_in_company(p_founder_id, v_company);
  perform private.check_today(p_today);
  if p_date < p_today then
    raise exception 'slots can only be added from today onward' using errcode = '22023';
  end if;
  insert into public.calendar_slots (company_id, founder_id, slot_date, ordinal, kind, note, created_by)
  values (v_company, p_founder_id, p_date,
          coalesce((select max(ordinal) + 1 from public.calendar_slots where founder_id = p_founder_id and slot_date = p_date), 0),
          'manual', coalesce(p_note, ''), auth.uid())
  returning id into v_id;
  perform private.log_event(v_company, 'calendar.slot_added', 'calendar_slot', v_id, jsonb_build_object('date', p_date));
  return v_id;
end;
$$;

-- Skip, unskip, move or delete one slot. Only open slots can be skipped or
-- moved; moving a planned slot skips it and adds a manual slot on the new date,
-- so later planning does not put it back.
create function public.update_slot(p_slot_id uuid, p_action text, p_new_date date, p_today date) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_company uuid := private.require_admin();
  v_slot public.calendar_slots;
  v_result uuid := p_slot_id;
begin
  perform private.check_today(p_today);
  select * into v_slot from public.calendar_slots where id = p_slot_id and company_id = v_company for update;
  if not found then
    raise exception 'slot not found' using errcode = 'P0002';
  end if;

  if p_action = 'skip' then
    if v_slot.status <> 'open' then raise exception 'only open slots can be skipped' using errcode = '22023'; end if;
    update public.calendar_slots set status = 'skipped' where id = p_slot_id;
  elsif p_action = 'unskip' then
    if v_slot.status <> 'skipped' then raise exception 'slot is not skipped' using errcode = '22023'; end if;
    update public.calendar_slots set status = 'open' where id = p_slot_id;
  elsif p_action = 'move' then
    if v_slot.status <> 'open' then raise exception 'only open slots can be moved' using errcode = '22023'; end if;
    if p_new_date is null or p_new_date < p_today then
      raise exception 'slots can only be moved to today or later' using errcode = '22023';
    end if;
    if v_slot.kind = 'manual' then
      update public.calendar_slots
         set slot_date = p_new_date,
             ordinal = coalesce((select max(ordinal) + 1 from public.calendar_slots
                                 where founder_id = v_slot.founder_id and slot_date = p_new_date and id <> p_slot_id), 0)
       where id = p_slot_id;
    else
      update public.calendar_slots set status = 'skipped', note = 'moved to ' || p_new_date where id = p_slot_id;
      insert into public.calendar_slots (company_id, founder_id, slot_date, ordinal, kind, note, created_by)
      values (v_company, v_slot.founder_id, p_new_date,
              coalesce((select max(ordinal) + 1 from public.calendar_slots where founder_id = v_slot.founder_id and slot_date = p_new_date), 0),
              'manual', 'moved from ' || v_slot.slot_date, auth.uid())
      returning id into v_result;
    end if;
  elsif p_action = 'delete' then
    if v_slot.kind <> 'manual' or v_slot.status <> 'open' then
      raise exception 'only open manual slots can be deleted; skip planned slots instead' using errcode = '22023';
    end if;
    delete from public.calendar_slots where id = p_slot_id;
  else
    raise exception 'unknown action %', p_action using errcode = '22023';
  end if;

  perform private.log_event(v_company,
    case p_action when 'skip' then 'calendar.slot_skipped' when 'unskip' then 'calendar.slot_unskipped'
                  when 'move' then 'calendar.slot_moved' else 'calendar.slot_deleted' end,
    'calendar_slot', p_slot_id, jsonb_build_object('date', v_slot.slot_date, 'new_date', p_new_date));
  return v_result;
end;
$$;

-- Slot counts for coverage, under the caller's row-level security.
-- lib/domain/coverage.ts countSlots() must agree (tests/db/coverage-parity.test.ts).
create function public.coverage_slot_counts(p_founder_id uuid, p_month date)
returns table (required integer, reserved_timely integer, open integer, filled integer, skipped integer)
language sql stable security invoker set search_path = '' as $$
  select
    count(*) filter (where status <> 'skipped')::integer,
    count(*) filter (where status <> 'skipped' and kind = 'reserved_timely')::integer,
    count(*) filter (where status = 'open')::integer,
    count(*) filter (where status = 'filled')::integer,
    count(*) filter (where status = 'skipped')::integer
  from public.calendar_slots
  where founder_id = p_founder_id
    and slot_date >= p_month and slot_date < (p_month + interval '1 month')::date;
$$;

revoke all on function
  private.require_admin(), private.require_founder_in_company(uuid, uuid), private.check_today(date)
from public, anon;
grant execute on function private.require_admin(), private.require_founder_in_company(uuid, uuid), private.check_today(date) to authenticated;

revoke all on function
  public.save_brief_version(date, text, jsonb, jsonb, jsonb, text),
  public.founder_brief(date),
  public.set_cadence_rule(uuid, date, public.cadence_period, integer, integer, smallint[], smallint[], integer, integer, integer, integer, integer, text, date),
  public.sync_calendar_slots(uuid, date, jsonb, date),
  public.add_manual_slot(uuid, date, text, date),
  public.update_slot(uuid, text, date, date),
  public.coverage_slot_counts(uuid, date)
from public, anon;
grant execute on function
  public.save_brief_version(date, text, jsonb, jsonb, jsonb, text),
  public.founder_brief(date),
  public.set_cadence_rule(uuid, date, public.cadence_period, integer, integer, smallint[], smallint[], integer, integer, integer, integer, integer, text, date),
  public.sync_calendar_slots(uuid, date, jsonb, date),
  public.add_manual_slot(uuid, date, text, date),
  public.update_slot(uuid, text, date, date),
  public.coverage_slot_counts(uuid, date)
to authenticated;
