-- Phase 8: pipeline management (docs/PHASES.md, docs/DATA_MODEL.md §12, D-35).
--
-- Coverage is computed once, here: every draft lands in exactly one bucket
-- (coverage_draft_buckets), and coverage() counts those buckets with the
-- slots and publications of the period. lib/domain/coverage.ts bucketOf() is
-- the TypeScript twin; tests/db/coverage-parity.test.ts checks they agree.
-- Nothing here writes: no path in this phase approves, schedules or publishes.

-- The replenishment batch ceiling (PRODUCT_SPEC §5.4). Set by the owner with
-- SQL, like the budget; the CHECK caps it at one concept run.
alter table public.settings
  add column batch_size_concepts smallint not null default 5 check (batch_size_concepts between 1 and 10);

-- An admin of the founder's company, or the service role (parity tests).
create function private.require_coverage_access(p_founder_id uuid) returns void
language plpgsql stable security definer set search_path = '' as $$
begin
  if coalesce(auth.role(), '') = 'service_role' then
    return;
  end if;
  perform private.require_founder_in_company(p_founder_id, private.require_admin());
end;
$$;

-- An open repetition warning on the draft's current version that points at
-- published content: a published LinkedIn post, or a studio draft that has
-- since been published. Such a draft is held back from the usable buffer
-- until the warning is resolved or overridden with a reason.
create function private.repeats_published(p_version_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.review_flags f
    where f.draft_version_id = p_version_id and f.kind = 'repetition' and f.status = 'open'
      and (f.compared_type = 'published_post'
           or (f.compared_type = 'draft'
               and exists (select 1 from public.drafts p where p.id = f.compared_id and p.status = 'published')))
  );
$$;

-- One row per draft of the founder, with the facts that decide its bucket and
-- the bucket. Period: p_from inclusive, p_to exclusive, in the founder's
-- calendar. Must agree with bucketOf() in lib/domain/coverage.ts.
create function public.coverage_draft_buckets(p_founder_id uuid, p_from date, p_to date)
returns table (
  draft_id uuid,
  status public.draft_status,
  is_external boolean,
  valid_approval boolean,
  repeats_published boolean,
  scheduled_on date,
  bucket text
)
language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.require_coverage_access(p_founder_id);
  return query
  with facts as (
    select d.id, d.status, d.is_external,
      (private.valid_approval(d.id)).id is not null as valid_approval,
      private.repeats_published(d.current_version_id) as repeats_published,
      (d.scheduled_for at time zone f.timezone)::date as scheduled_on
    from public.drafts d
    join public.founders f on f.id = d.founder_id
    where d.founder_id = p_founder_id
  )
  select x.id, x.status, x.is_external, x.valid_approval, x.repeats_published, x.scheduled_on,
    case
      when x.is_external then 'external'
      when x.status in ('rejected', 'archived') then 'excluded'
      when x.status = 'published' then 'published'
      when x.status = 'scheduled' and not x.valid_approval then 'approval_invalid'
      when x.status = 'scheduled' and x.scheduled_on >= p_from and x.scheduled_on < p_to then 'scheduled'
      when x.status = 'scheduled' then 'scheduled_other_period'
      when x.status = 'approved' and not x.valid_approval then 'approval_invalid'
      when x.status = 'approved' and x.repeats_published then 'held_repeat'
      when x.status = 'approved' then 'approved_unscheduled'
      when x.status = 'founder_review' then 'founder_review'
      else 'admin_review' -- drafting, admin_review, changes_requested
    end
  from facts x;
end;
$$;

-- Coverage for one founder and period (DATA_MODEL §12.3): the slot counts,
-- publications dated in the period, the draft buckets, concepts waiting, and
-- the next open planned slot from p_today. The status and shortfall are
-- derived from these in lib/domain/coverage.ts.
create function public.coverage(p_founder_id uuid, p_from date, p_to date, p_today date)
returns table (
  slots_required integer,
  slots_reserved_timely integer,
  slots_open integer,
  slots_filled integer,
  slots_skipped integer,
  published integer,
  scheduled integer,
  approved_unscheduled integer,
  in_founder_review integer,
  in_admin_review integer,
  concepts_waiting integer,
  scheduled_other_period integer,
  held_repeat integer,
  approval_invalid integer,
  published_drafts integer,
  external_drafts integer,
  excluded integer,
  next_open_slot date
)
language plpgsql stable security definer set search_path = '' as $$
declare
  v_timezone text;
begin
  perform private.require_coverage_access(p_founder_id);
  if p_from is null or p_to is null or p_to <= p_from then
    raise exception 'choose a period' using errcode = '22023';
  end if;
  select timezone into v_timezone from public.founders where id = p_founder_id;
  return query
  with buckets as (
    select b.bucket from public.coverage_draft_buckets(p_founder_id, p_from, p_to) b
  ),
  slots as (
    select s.kind, s.status from public.calendar_slots s
    where s.founder_id = p_founder_id and s.slot_date >= p_from and s.slot_date < p_to
  )
  select
    (select count(*) filter (where s.status <> 'skipped') from slots s)::integer,
    (select count(*) filter (where s.status <> 'skipped' and s.kind = 'reserved_timely') from slots s)::integer,
    (select count(*) filter (where s.status = 'open') from slots s)::integer,
    (select count(*) filter (where s.status = 'filled') from slots s)::integer,
    (select count(*) filter (where s.status = 'skipped') from slots s)::integer,
    (select count(*) from public.publications p
     where p.founder_id = p_founder_id
       and (p.published_at at time zone v_timezone)::date >= p_from
       and (p.published_at at time zone v_timezone)::date < p_to)::integer,
    (select count(*) filter (where b.bucket = 'scheduled') from buckets b)::integer,
    (select count(*) filter (where b.bucket = 'approved_unscheduled') from buckets b)::integer,
    (select count(*) filter (where b.bucket = 'founder_review') from buckets b)::integer,
    (select count(*) filter (where b.bucket = 'admin_review') from buckets b)::integer,
    (select count(*) from public.concepts c
     where c.founder_id = p_founder_id and c.status = 'selected'
       and not exists (select 1 from public.drafts d
                       where d.concept_id = c.id and d.status not in ('rejected', 'archived')))::integer,
    (select count(*) filter (where b.bucket = 'scheduled_other_period') from buckets b)::integer,
    (select count(*) filter (where b.bucket = 'held_repeat') from buckets b)::integer,
    (select count(*) filter (where b.bucket = 'approval_invalid') from buckets b)::integer,
    (select count(*) filter (where b.bucket = 'published') from buckets b)::integer,
    (select count(*) filter (where b.bucket = 'external') from buckets b)::integer,
    (select count(*) filter (where b.bucket = 'excluded') from buckets b)::integer,
    -- Slots kept for news are not filled with planned content.
    (select min(s.slot_date) from public.calendar_slots s
     where s.founder_id = p_founder_id and s.status = 'open' and s.kind <> 'reserved_timely'
       and s.slot_date >= p_today);
end;
$$;

-- What replenishment counts for one target month (DATA_MODEL §12.4):
-- candidates not yet used (concepts with no live draft, live drafts not yet
-- approved) and drafts scheduled in the month.
create function public.candidate_supply(p_founder_id uuid, p_month date)
returns table (concepts_open integer, drafts_in_progress integer, scheduled_in_month integer, batch_size integer)
language plpgsql stable security definer set search_path = '' as $$
declare
  v_to date := (p_month + interval '1 month')::date;
begin
  perform private.require_coverage_access(p_founder_id);
  if p_month is null or extract(day from p_month) <> 1 then
    raise exception 'choose a month' using errcode = '22023';
  end if;
  return query
  select
    (select count(*) from public.concepts c
     where c.founder_id = p_founder_id and c.target_month = p_month and c.status in ('proposed', 'selected')
       and not exists (select 1 from public.drafts d
                       where d.concept_id = c.id and d.status not in ('rejected', 'archived')))::integer,
    (select count(*) from public.drafts d
     where d.founder_id = p_founder_id and d.target_month = p_month and not d.is_external
       and d.status in ('drafting', 'admin_review', 'founder_review', 'changes_requested'))::integer,
    (select count(*) from public.coverage_draft_buckets(p_founder_id, p_month, v_to) b
     where b.bucket = 'scheduled')::integer,
    (select s.batch_size_concepts from public.settings s
     join public.founders f on f.company_id = s.company_id where f.id = p_founder_id)::integer;
end;
$$;

revoke all on function
  private.require_coverage_access(uuid),
  private.repeats_published(uuid),
  public.coverage_draft_buckets(uuid, date, date),
  public.coverage(uuid, date, date, date),
  public.candidate_supply(uuid, date)
from public, anon;
grant execute on function
  public.coverage_draft_buckets(uuid, date, date),
  public.coverage(uuid, date, date, date),
  public.candidate_supply(uuid, date)
to authenticated, service_role;
