-- Phase 3: founder voice profiles (versioned), writing examples, and feedback
-- signals. See docs/PRODUCT_SPEC.md §5.5, docs/DATA_MODEL.md §4, §8.
--
-- Retrieval of examples for generation is pure TypeScript
-- (lib/domain/retrieval.ts, decision D-25); the database guarantees what may
-- be retrieved: only a founder's own approved examples, never held-out ones.

create type public.post_format as enum (
  'story', 'opinion', 'how_to', 'data_insight', 'lesson', 'announcement', 'list', 'question', 'other'
);
create type public.writing_example_kind as enum ('published_linkedin', 'approved_example', 'slack_excerpt', 'other');
create type public.feedback_kind as enum ('stable_preference', 'format_preference', 'one_off', 'editorial_correction');
create type public.feedback_status as enum ('proposed', 'accepted', 'rejected');
create type public.feedback_proposer as enum ('system', 'admin');

-- ---------------------------------------------------------------------------
-- Voice profiles
-- ---------------------------------------------------------------------------

create table public.voice_profiles (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id),
  founder_id uuid not null unique references public.founders (id) on delete cascade,
  current_version_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.voice_profile_versions (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.voice_profiles (id) on delete cascade,
  company_id uuid not null references public.companies (id),
  founder_id uuid not null references public.founders (id) on delete cascade,
  version_no integer not null check (version_no > 0),
  -- Sentence length, paragraph style, humor, technical depth, point of view.
  attributes jsonb not null default '{}'::jsonb check (jsonb_typeof(attributes) = 'object'),
  preferred_phrases text[] not null default '{}',
  avoid_phrases text[] not null default '{}',
  -- The only topics the generator may write about in the first person.
  expertise_topics text[] not null default '{}',
  writing_habits text[] not null default '{}',
  -- Style rules agreed with this founder (D-15), e.g. "No em-dashes".
  style_rules text[] not null default '{}',
  -- Keyed by post_format.
  format_preferences jsonb not null default '{}'::jsonb check (jsonb_typeof(format_preferences) = 'object'),
  notes text not null default '' check (length(notes) <= 4000),
  change_reason text not null check (length(trim(change_reason)) between 1 and 500),
  source_feedback_ids uuid[] not null default '{}',
  created_by uuid references public.profiles (user_id) on delete set null,
  created_at timestamptz not null default now(),
  unique (profile_id, version_no)
);
create index voice_profile_versions_profile_idx on public.voice_profile_versions (profile_id, version_no desc);

alter table public.voice_profiles
  add constraint voice_profiles_current_version_fk
  foreign key (current_version_id) references public.voice_profile_versions (id);

create trigger voice_profiles_touch before update on public.voice_profiles
  for each row execute function private.touch_updated_at();
create trigger voice_profile_versions_immutable before update or delete on public.voice_profile_versions
  for each row execute function private.reject_change();

-- ---------------------------------------------------------------------------
-- Writing examples
-- ---------------------------------------------------------------------------

create table public.writing_examples (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id),
  founder_id uuid not null references public.founders (id) on delete cascade,
  kind public.writing_example_kind not null,
  body text not null check (length(trim(body)) between 1 and 10000),
  -- Pasting the same post twice is a no-op.
  body_hash text generated always as (md5(btrim(body))) stored,
  source_url text check (source_url is null or (source_url ~ '^https://[^\s]+$' and length(source_url) <= 2000)),
  published_at date,
  format public.post_format,
  topics text[] not null default '{}' check (cardinality(topics) <= 20),
  -- Only approved examples are retrieved for generation.
  approved_for_voice boolean not null default false,
  -- Part of the voice evaluation set: never retrieved, so it can be compared
  -- against generated drafts (docs/PHASES.md, Phase 3).
  eval_holdout boolean not null default false,
  added_by uuid references public.profiles (user_id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (founder_id, body_hash),
  check (not eval_holdout or approved_for_voice)
);
create index writing_examples_founder_idx on public.writing_examples (founder_id, approved_for_voice);

create trigger writing_examples_touch before update on public.writing_examples
  for each row execute function private.touch_updated_at();

-- ---------------------------------------------------------------------------
-- Feedback signals
-- ---------------------------------------------------------------------------

create table public.feedback_signals (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id),
  founder_id uuid not null references public.founders (id) on delete cascade,
  -- References drafts and comments from Phase 4 and 7; foreign keys come with those tables.
  draft_version_id uuid,
  comment_id uuid,
  kind public.feedback_kind not null,
  format public.post_format,
  statement text not null check (length(trim(statement)) between 1 and 1000),
  proposed_by public.feedback_proposer not null,
  status public.feedback_status not null default 'proposed',
  applied_voice_profile_version_id uuid references public.voice_profile_versions (id),
  review_note text not null default '' check (length(review_note) <= 500),
  reviewed_by uuid references public.profiles (user_id) on delete set null,
  reviewed_at timestamptz,
  created_by uuid references public.profiles (user_id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (kind <> 'format_preference' or format is not null),
  -- Only stable and format preferences can ever shape a voice profile, and
  -- they are accepted only by being applied to a profile version.
  constraint feedback_applied_only_voice_kinds check (
    applied_voice_profile_version_id is null
    or (status = 'accepted' and kind in ('stable_preference', 'format_preference'))
  ),
  constraint feedback_voice_kinds_accepted_by_applying check (
    status <> 'accepted' or kind not in ('stable_preference', 'format_preference')
    or applied_voice_profile_version_id is not null
  ),
  check ((status = 'proposed') = (reviewed_at is null))
);
create index feedback_signals_founder_idx on public.feedback_signals (founder_id, status);

create trigger feedback_signals_touch before update on public.feedback_signals
  for each row execute function private.touch_updated_at();

-- ---------------------------------------------------------------------------
-- Privileges and row-level security
-- ---------------------------------------------------------------------------

alter table public.voice_profiles enable row level security;
alter table public.voice_profile_versions enable row level security;
alter table public.writing_examples enable row level security;
alter table public.feedback_signals enable row level security;

revoke insert, update, delete, truncate on
  public.voice_profiles, public.voice_profile_versions, public.writing_examples, public.feedback_signals
from authenticated;

-- A founder reads their own profile and examples (D-13); never other founders'.
create policy voice_profiles_select on public.voice_profiles for select to authenticated
  using (
    (private.is_admin() and company_id = private.current_company_id())
    or founder_id = private.current_founder_id()
  );
create policy voice_profile_versions_select on public.voice_profile_versions for select to authenticated
  using (
    (private.is_admin() and company_id = private.current_company_id())
    or founder_id = private.current_founder_id()
  );
create policy writing_examples_select on public.writing_examples for select to authenticated
  using (
    (private.is_admin() and company_id = private.current_company_id())
    or founder_id = private.current_founder_id()
  );
-- Feedback signals are admin curation.
create policy feedback_signals_admin_select on public.feedback_signals for select to authenticated
  using (private.is_admin() and company_id = private.current_company_id());

-- ---------------------------------------------------------------------------
-- Functions
-- ---------------------------------------------------------------------------

-- Lower-cased, trimmed, de-duplicated, non-empty.
create function private.clean_tags(p_tags text[]) returns text[]
language sql immutable set search_path = '' as $$
  select coalesce(array_agg(distinct t order by t), '{}')
  from (select lower(btrim(x)) t from unnest(coalesce(p_tags, '{}')) x) s
  where t <> '';
$$;

create function private.clean_lines(p_items text[]) returns text[]
language sql immutable set search_path = '' as $$
  select coalesce(array_agg(t order by n), '{}')
  from (select btrim(x) t, n from unnest(coalesce(p_items, '{}')) with ordinality u (x, n)) s
  where t <> '';
$$;

-- Saves the next version of a founder's voice profile. Stable and format
-- preference signals passed in p_feedback_ids are accepted by this save and
-- record the version they produced; no other kind can be applied.
create function public.save_voice_profile_version(
  p_founder_id uuid,
  p_attributes jsonb,
  p_preferred_phrases text[],
  p_avoid_phrases text[],
  p_expertise_topics text[],
  p_writing_habits text[],
  p_style_rules text[],
  p_format_preferences jsonb,
  p_notes text,
  p_change_reason text,
  p_feedback_ids uuid[]
) returns integer
language plpgsql security definer set search_path = '' as $$
declare
  v_company uuid := private.require_admin();
  v_profile uuid;
  v_no integer;
  v_version uuid;
  v_ids uuid[] := coalesce(p_feedback_ids, '{}');
begin
  perform private.require_founder_in_company(p_founder_id, v_company);
  if exists (
    select 1 from jsonb_object_keys(coalesce(p_format_preferences, '{}'::jsonb)) k
    where k not in (select unnest(enum_range(null::public.post_format))::text)
  ) then
    raise exception 'unknown post format' using errcode = '22023';
  end if;
  if (
    select count(*) from public.feedback_signals s
    where s.id = any (v_ids)
      and s.founder_id = p_founder_id
      and s.kind in ('stable_preference', 'format_preference')
      and s.status = 'proposed'
  ) <> cardinality(array(select distinct unnest(v_ids))) then
    raise exception 'only proposed stable or format preferences of this founder can change a voice profile'
      using errcode = '22023';
  end if;

  insert into public.voice_profiles (company_id, founder_id)
  values (v_company, p_founder_id)
  on conflict (founder_id) do update set updated_at = now()
  returning id into v_profile;

  perform 1 from public.voice_profiles where id = v_profile for update;
  select coalesce(max(version_no), 0) + 1 into v_no from public.voice_profile_versions where profile_id = v_profile;

  insert into public.voice_profile_versions (
    profile_id, company_id, founder_id, version_no, attributes, preferred_phrases, avoid_phrases,
    expertise_topics, writing_habits, style_rules, format_preferences, notes, change_reason,
    source_feedback_ids, created_by
  ) values (
    v_profile, v_company, p_founder_id, v_no, coalesce(p_attributes, '{}'::jsonb),
    private.clean_lines(p_preferred_phrases), private.clean_lines(p_avoid_phrases),
    private.clean_lines(p_expertise_topics), private.clean_lines(p_writing_habits),
    private.clean_lines(p_style_rules), coalesce(p_format_preferences, '{}'::jsonb),
    coalesce(p_notes, ''), btrim(coalesce(p_change_reason, '')), v_ids, auth.uid()
  ) returning id into v_version;

  update public.voice_profiles set current_version_id = v_version where id = v_profile;
  update public.feedback_signals
  set status = 'accepted', applied_voice_profile_version_id = v_version, reviewed_by = auth.uid(), reviewed_at = now()
  where id = any (v_ids);

  perform private.log_event(v_company, 'voice.version_saved', 'voice_profile', v_profile,
    jsonb_build_object('founder_id', p_founder_id, 'version', v_no, 'feedback_applied', cardinality(v_ids)));
  return v_no;
end;
$$;

-- Adds writing examples; returns {"added": n, "duplicates": m}. The admin may
-- add any kind for any founder. A founder may add only approved examples of
-- their own writing, which are approved for voice (they chose to share them).
create function public.add_writing_examples(p_founder_id uuid, p_items jsonb)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_admin boolean := private.is_admin();
  v_company uuid := private.current_company_id();
  v_item jsonb;
  v_added integer := 0;
  v_rows integer;
begin
  if v_admin then
    perform private.require_founder_in_company(p_founder_id, v_company);
  elsif p_founder_id is distinct from private.current_founder_id() then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) not between 1 and 100 then
    raise exception 'add between 1 and 100 examples at a time' using errcode = '22023';
  end if;

  for v_item in select * from jsonb_array_elements(p_items) loop
    if not v_admin and coalesce(v_item ->> 'kind', 'approved_example') <> 'approved_example' then
      raise exception 'founders can only add approved examples' using errcode = '42501';
    end if;
    insert into public.writing_examples (
      company_id, founder_id, kind, body, source_url, published_at, format, topics,
      approved_for_voice, added_by
    ) values (
      v_company, p_founder_id,
      coalesce(v_item ->> 'kind', 'approved_example')::public.writing_example_kind,
      btrim(v_item ->> 'body'),
      nullif(btrim(coalesce(v_item ->> 'source_url', '')), ''),
      nullif(v_item ->> 'published_at', '')::date,
      nullif(v_item ->> 'format', '')::public.post_format,
      private.clean_tags(array(select jsonb_array_elements_text(coalesce(v_item -> 'topics', '[]'::jsonb)))),
      case when v_admin then coalesce((v_item ->> 'approved_for_voice')::boolean, false) else true end,
      auth.uid()
    )
    on conflict (founder_id, body_hash) do nothing;
    get diagnostics v_rows = row_count;
    v_added := v_added + v_rows;
  end loop;

  perform private.log_event(v_company, 'example.added', 'founder', p_founder_id,
    jsonb_build_object('added', v_added, 'submitted', jsonb_array_length(p_items)));
  return jsonb_build_object('added', v_added, 'duplicates', jsonb_array_length(p_items) - v_added);
end;
$$;

create function public.update_writing_example(
  p_example_id uuid,
  p_approved_for_voice boolean,
  p_eval_holdout boolean,
  p_format public.post_format,
  p_topics text[]
) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_company uuid := private.require_admin();
begin
  update public.writing_examples
  set approved_for_voice = p_approved_for_voice,
      eval_holdout = p_eval_holdout and p_approved_for_voice,
      format = p_format,
      topics = private.clean_tags(p_topics)
  where id = p_example_id and company_id = v_company;
  if not found then
    raise exception 'example not found' using errcode = 'P0002';
  end if;
  perform private.log_event(v_company, 'example.updated', 'writing_example', p_example_id,
    jsonb_build_object('approved_for_voice', p_approved_for_voice, 'eval_holdout', p_eval_holdout and p_approved_for_voice));
end;
$$;

create function public.delete_writing_example(p_example_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_company uuid := private.require_admin();
begin
  delete from public.writing_examples where id = p_example_id and company_id = v_company;
  if not found then
    raise exception 'example not found' using errcode = 'P0002';
  end if;
  perform private.log_event(v_company, 'example.deleted', 'writing_example', p_example_id);
end;
$$;

-- Signals are entered by the admin in Phase 3; the system proposes them from
-- Phase 7 (with proposed_by = 'system').
create function public.add_feedback_signal(
  p_founder_id uuid,
  p_kind public.feedback_kind,
  p_format public.post_format,
  p_statement text
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_company uuid := private.require_admin();
  v_id uuid;
begin
  perform private.require_founder_in_company(p_founder_id, v_company);
  insert into public.feedback_signals (company_id, founder_id, kind, format, statement, proposed_by, created_by)
  values (v_company, p_founder_id, p_kind, case when p_kind = 'format_preference' then p_format end,
          btrim(p_statement), 'admin', auth.uid())
  returning id into v_id;
  perform private.log_event(v_company, 'feedback.added', 'feedback_signal', v_id,
    jsonb_build_object('founder_id', p_founder_id, 'kind', p_kind));
  return v_id;
end;
$$;

-- Rejects any proposed signal, or accepts a one-off or editorial one (recorded
-- only; it never touches a voice profile). Stable and format preferences are
-- accepted by saving a voice profile version with them.
create function public.review_feedback_signal(p_signal_id uuid, p_decision text, p_note text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_company uuid := private.require_admin();
  v_signal public.feedback_signals;
begin
  select * into v_signal from public.feedback_signals
  where id = p_signal_id and company_id = v_company for update;
  if not found then
    raise exception 'signal not found' using errcode = 'P0002';
  end if;
  if v_signal.status <> 'proposed' then
    raise exception 'signal already reviewed' using errcode = '22023';
  end if;
  if p_decision = 'accept' and v_signal.kind in ('stable_preference', 'format_preference') then
    raise exception 'apply a voice preference by saving a voice profile version with it' using errcode = '22023';
  end if;
  if p_decision not in ('accept', 'reject') then
    raise exception 'unknown decision' using errcode = '22023';
  end if;
  update public.feedback_signals
  set status = case when p_decision = 'accept' then 'accepted' else 'rejected' end::public.feedback_status,
      review_note = btrim(coalesce(p_note, '')), reviewed_by = auth.uid(), reviewed_at = now()
  where id = p_signal_id;
  perform private.log_event(v_company, 'feedback.' || case when p_decision = 'accept' then 'accepted' else 'rejected' end,
    'feedback_signal', p_signal_id);
end;
$$;

revoke all on function private.clean_tags(text[]), private.clean_lines(text[]) from public, anon;
grant execute on function private.clean_tags(text[]), private.clean_lines(text[]) to authenticated;

revoke all on function
  public.save_voice_profile_version(uuid, jsonb, text[], text[], text[], text[], text[], jsonb, text, text, uuid[]),
  public.add_writing_examples(uuid, jsonb),
  public.update_writing_example(uuid, boolean, boolean, public.post_format, text[]),
  public.delete_writing_example(uuid),
  public.add_feedback_signal(uuid, public.feedback_kind, public.post_format, text),
  public.review_feedback_signal(uuid, text, text)
from public, anon;
grant execute on function
  public.save_voice_profile_version(uuid, jsonb, text[], text[], text[], text[], text[], jsonb, text, text, uuid[]),
  public.add_writing_examples(uuid, jsonb),
  public.update_writing_example(uuid, boolean, boolean, public.post_format, text[]),
  public.delete_writing_example(uuid),
  public.add_feedback_signal(uuid, public.feedback_kind, public.post_format, text),
  public.review_feedback_signal(uuid, text, text)
to authenticated;
