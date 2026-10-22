# Data Model

> **Implemented so far (Phase 1, migration `20261021000001_foundation.sql`):**
> `companies`, `profiles`, `founders`, `founder_visibility_grants`, `settings`,
> `audit_events`, the `private.*` helpers, and the functions `record_sign_in`,
> `admin_set_user_role`, `admin_deactivate_user` and `provision_invited_user`.
> Differences from the proposal below, all deliberate:
>
> - `provision_invited_user(user_id, role, invited_by, founder_id)` reads the
>   email from Auth itself instead of taking it as a parameter.
> - A trigger on `auth.users` rejects any email outside
>   `settings.allowed_email_domains`, on every path. The Auth hook alone did not
>   cover the admin "create user" endpoint (found in local testing).
> - Founders cannot edit their own founder record yet; only their profile's
>   display name. The admin edits founder records.
> - `private.is_admin()` also requires an MFA-verified session (`aal2`), so
>   admin rights do not exist in the database without two-factor sign-in.
> - `audit_events` uses a bigint identity key, and is append-only for every
>   role, including the database owner (trigger).
>
> **Implemented in Phase 2 (migration `20261021000002_strategy_cadence.sql`):**
> `monthly_briefs`, `brief_versions`, `cadence_rules`, `calendar_slots`, and
> the functions `save_brief_version`, `founder_brief`, `set_cadence_rule`,
> `sync_calendar_slots`, `add_manual_slot`, `update_slot` and
> `coverage_slot_counts`. Differences from the proposal below, all deliberate:
>
> - Every write goes through those functions; `authenticated` has no direct
>   insert, update or delete on the four tables. Each function audits.
> - Founders read briefs only through `founder_brief(month)`, which returns the
>   month, version number, theme and the caller's own emphasis block (D-13).
>   The raw brief tables are admin-only.
> - Slot dates are computed in TypeScript (`lib/domain/cadence.ts`, unit-tested
>   against hand-computed fixtures) and handed to `sync_calendar_slots`, which
>   checks that every slot falls on a date with a rule in effect, then adds and
>   removes only **open, future, cadence-generated** slots. Past, filled,
>   skipped and manual slots are never touched, and the filled slots outside
>   the new cadence that it had to keep are returned (D-23).
> - Moving a slot skips the original and adds a manual slot on the new date,
>   so re-planning cannot bring the old date back (D-24).
> - `slot_time`, `preferred_local_time` exist but are unused until scheduling
>   (Phase 7). `calendar_slots.draft_id` has no foreign key until `drafts`
>   exists (Phase 4).
> - Coverage: only the slot part exists so far. `coverage_slot_counts` counts
>   slots in SQL, and `lib/domain/coverage.ts` holds the full formula with the
>   draft buckets at zero. A test checks the two agree. The single
>   `app.coverage` view in §12 is built in Phase 4, when drafts exist (D-23).
>
> **Implemented in Phase 3 (migration `20261021000003_voice_library.sql`):**
> `voice_profiles`, `voice_profile_versions`, `writing_examples`,
> `feedback_signals`, the `post_format` enum, and the functions
> `save_voice_profile_version`, `add_writing_examples`,
> `update_writing_example`, `delete_writing_example`, `add_feedback_signal`
> and `review_feedback_signal`. Differences from the proposal below, all
> deliberate:
>
> - `voice_profile_versions` also has `founder_id` (for RLS), plus
>   `writing_habits` and `style_rules` lists (D-26). `change_reason` is
>   required.
> - `writing_examples` has no `search tsvector`; retrieval is TypeScript
>   (D-25). It adds `eval_holdout` (never retrieved; only on approved examples)
>   and `body_hash`, unique per founder, so pasting a post twice is a no-op.
>   `source_url` must be `https://`. `publication_id` comes with publications
>   (Phase 10).
> - `feedback_signals` adds `format`, required for format preferences, and
>   `review_note`. Constraints: a signal linked to a profile version must be
>   an accepted stable or format preference, and an accepted stable or format
>   preference must be linked to one. Signals are admin-only; founders don't
>   see them.
> - Founders read their own profile, versions and examples, and can add
>   their own `approved_example` through `add_writing_examples` (D-26).
>   Nothing else is writable by a founder.
>
> **Implemented in Phase 4a (migration `20261021000004_generation_concepts.sql`):**
> `generation_runs`, `concepts`, two ceiling columns on `settings`, and
> the functions `request_generation`, `ai_spend_summary`, `update_concept` and
> `set_concept_status` (admin), plus `claim_generation_run`,
> `requeue_stale_runs`, `fail_generation_run` and `complete_concept_run`
> (job runner, `service_role` only). Differences from the proposal below:
>
> - `generation_runs` adds `target_month`, `params`, `run_after` (retry
>   time), `served_model` (the model that answered, which differs after a
>   refusal fallback), `cache_write_tokens`, and both `estimated_cost_usd`
>   (checked before the run) and `actual_cost_usd`. Status adds `refused`
>   (over a ceiling; never ran).
> - The cost ledger is the function `ai_spend_summary` over
>   `generation_runs`, not a table (D-28).
> - `concepts` adds `voice_profile_version_id`, `needs_personal_story`,
>   `superseded_by` (set when regenerated; the old row is archived) and
>   `edited_by`/`edited_at`. `concept_evidence` waits for Phase 5 (D-29).
> - Runs, costs and concepts are admin-only; founders see none of them.
>
> **Implemented in Phase 4b (migration `20261022000001_drafts.sql`):**
> `drafts`, `draft_versions`, `draft_claims`, `review_flags`,
> `repetition_checks`, `private.normalize_body`, and the functions
> `complete_draft_run` (runner), `save_draft_version`, `resolve_review_flag`,
> `transition_draft` and `repetition_candidates`. Differences from the
> proposal below:
>
> - `drafts` adds `target_month` and `generation_run_id`. `draft_versions`
>   adds `founder_id`, `company_id` and `change_note`; `body_normalized_hash`
>   and `placeholder_count` are set by trigger.
> - `draft_claims` adds `approved_fact`, the brief's wording of the fact that
>   backs a claim. `finding_id` gets its foreign key in Phase 5.
> - `review_flags` adds `source` (model, lint, placeholder, claims,
>   repetition), `compared_type`/`compared_id` for repetition, and
>   `resolved_at`. An override must record a reason (CHECK). There is no
>   `repetition_overrides` table: overrides live on the flag (D-30).
> - All five tables are admin-only. Founders read their own shared drafts
>   through functions (Phase 7).
>
> **Implemented in Phase 7 (migration `20261022000002_review_approval.sql`):**
> `approvals`, `comments`, `rewrite_requests`, the material-edit trigger on
> `draft_versions`, and these functions:
>
> - admin: `share_draft`, `transition_draft` and `save_draft_version`
>   (replaced);
> - founder: `founder_drafts`, `founder_draft_versions`,
>   `founder_draft_flags`, `founder_comments`, `founder_rewrite_requests`,
>   `founder_save_version`, `approve_draft`, `revoke_approval`,
>   `request_changes`, `founder_reject_draft` and `request_rewrite`;
> - both: `add_comment` and `resolve_comment`;
> - runner: `complete_draft_run` (replaced, adds rewrites),
>   `complete_feedback_run` and `set_run_input_refs`.
>
> Differences from the proposal below (D-32):
>
> - `approvals` adds `selected_hook`, the normalized selected opening line.
>   A valid approval matches the current version's hash and selected line,
>   not its id, so a whitespace-only edit keeps it.
> - `approvals` is insert-only for every role (trigger): an approval can only
>   be invalidated, once, through the functions.
> - `comments.anchor` is `{"quote": "…"}`. Founders can only write `shared`
>   comments (CHECK).
> - All three tables are admin-only to read. Founders use the functions,
>   which never return the rationale, internal comments or unshared flags.

Status: **Phase 0 proposal**, 2026-10-21. Postgres (Supabase). Nothing here is
migrated yet. Table and column names are proposals that will be finalized in
the Phase 1 and Phase 2 migrations.

Conventions:

- Every table has `id uuid primary key default gen_random_uuid()`,
  `created_at timestamptz not null default now()`, and, where rows are mutable,
  `updated_at`.
- Every business table has `company_id uuid not null references companies`.
  This is the company data boundary (§2). For the MVP there is exactly one
  company row.
- Status columns are Postgres enums. Allowed transitions live in one SQL
  function per workflow (§7) and are not scattered across the app.
- **Immutable** tables (versions, approvals, audit events, generation runs once
  finished) reject `UPDATE`/`DELETE` through RLS. A trigger blocks content
  changes too, for when the service role is used.
- Identifiers exposed in URLs are UUIDs. They are unguessable, but they are
  **never** relied on for access control. RLS is (SECURITY §4).
- Times are stored in UTC. A founder's `timezone` (IANA name) is used for slot
  and calendar computation.

---

## 1. Entity overview

```
companies ─┬─ profiles (auth.users 1:1) ── role: admin | founder
           ├─ founders ── voice_profiles ── voice_profile_versions
           │     │    └── cadence_rules ── calendar_slots
           │     ├─ writing_examples
           │     └─ founder_visibility_grants
           ├─ monthly_briefs ── brief_versions
           ├─ research_queries ── research_sources ── research_findings
           ├─ integration_connections ── slack_channels ── slack_messages (short-lived)
           │                                              └── insights ── insight_sources
           ├─ concepts ── concept_evidence (→ findings | insights)
           │     └── drafts ── draft_versions ── draft_claims (→ findings)
           │            │            └── review_flags
           │            ├── approvals (→ one draft_version)
           │            ├── comments
           │            ├── feedback_signals
           │            ├── repetition_checks / repetition_overrides
           │            └── publications ── performance_snapshots
           ├─ generation_runs (every AI call: inputs, model, cost)
           ├─ cost_ledger / settings
           └─ audit_events (append-only)
```

---

## 2. Tenancy and identity

### `companies`
`id, name, slug`. One row for the MVP. It exists so every other row can carry
`company_id` and so a future second company would mean data, not a rewrite.

### `profiles`
One row per Supabase Auth user.

| Column | Notes |
|---|---|
| `user_id uuid pk references auth.users on delete cascade` | |
| `company_id` | |
| `role` enum `admin`, `founder` | Never read from client-supplied data or user-editable `user_metadata`. Set by the invite flow (server, service role) |
| `display_name`, `email` | |
| `status` enum `invited`, `active`, `deactivated` | Deactivated users fail every RLS check |

**Access:** a user reads their own row. Admins read and update all rows in
their company. Nobody can update their own `role` (column-level privilege plus
a trigger).

Helper SQL functions are `security definer`, `stable`, with
`search_path = ''`. RLS policies use them:

- `app.current_company_id()`
- `app.is_admin()`: the role is `admin` and the status is `active`
- `app.current_founder_id()`: the `founders.id` linked to `auth.uid()`, or null
- `app.can_see_founder(founder_id)`: the caller is an admin, is that founder,
  or holds a grant (§3)

### `founders`
A founder is a content subject. They may or may not have a login yet.

| Column | Notes |
|---|---|
| `user_id uuid null unique references profiles` | Linked when the invite is accepted |
| `role_title` | e.g. CEO, CTO, COO. Free text, not an enum |
| `display_name`, `linkedin_profile_url`, `timezone` | |
| `active bool` | |

**Access:** admins have full access. A founder reads their own row and updates
a whitelist of their own fields (e.g. display name).

### `founder_visibility_grants`
`grantee_founder_id, subject_founder_id, scope enum('calendar','approved_content','drafts'), granted_by, expires_at`.
Admin-only writes. This is the explicit authorization required for one founder
to see another founder's content. There are none by default.

---

## 3. Strategy

### `monthly_briefs`
`company_id, month date (first day of month), title, current_version_id`.
Unique on `(company_id, month)`.

### `brief_versions` (immutable)

| Column | Notes |
|---|---|
| `brief_id`, `version_no` | unique `(brief_id, version_no)` |
| `content jsonb` | Validated by a Zod schema in the app and a JSON-schema check constraint (theme required) |
| `founder_emphasis jsonb` | Keyed by `founder_id` |
| `approved_facts jsonb` | Facts and messaging the generator may state as fact |
| `created_by`, `change_note` | |

Concepts and drafts reference `brief_version_id`, never `brief_id`. That keeps
new versions from changing what existing content was based on.

**Access:** admin has full access. Founders see only the theme and their own
emphasis block, through a view, not the raw table (D-13).

---

## 4. Founder voice

### `voice_profiles`
`founder_id unique, current_version_id`.

### `voice_profile_versions` (immutable)
`profile_id, version_no, attributes jsonb` (sentence length, paragraph
style, humor, technical depth, POV, habits), `preferred_phrases text[]`,
`avoid_phrases text[]`, `expertise_topics text[]`, `format_preferences jsonb`,
`notes, created_by, change_reason, source_feedback_ids uuid[]`.

### `writing_examples`

| Column | Notes |
|---|---|
| `founder_id` | |
| `kind` enum `published_linkedin`, `approved_example`, `slack_excerpt`, `other` | |
| `body text`, `source_url`, `published_at` | |
| `approved_for_voice bool` | Only approved examples are retrieved for generation |
| `format`, `topics text[]` | For relevance retrieval |
| `search tsvector` (generated) | Full-text index |
| `added_by` | |

Published studio posts are linked automatically as examples (with
`approved_for_voice` defaulting to true), via `publication_id`.

**Access:** admin has full access. A founder can read their own examples and
add `approved_example` rows (a decision; default yes).

---

## 5. Cadence and calendar

### `cadence_rules` (versioned by effective date)

| Column | Notes |
|---|---|
| `founder_id` | |
| `effective_from date`, `effective_to date null` | Non-overlapping per founder (exclusion constraint on `daterange`) |
| `period` enum `week`, `month` | |
| `min_posts`, `max_posts` | check `0 < min_posts <= max_posts` |
| `weekly_pattern int[] null` | |
| `publishing_days smallint[]` | ISO weekday 1–7, in preference order |
| `preferred_local_time time null` | |
| `reserved_timely_slots_per_month` | |
| `buffer_target`, `low_buffer_threshold` | |
| `candidate_target_min`, `candidate_target_max` | |
| `created_by`, `change_reason` | |

A change closes the current rule (`effective_to`) and inserts a new one.
Nothing is updated in place once the rule has produced slots.

### `calendar_slots`

| Column | Notes |
|---|---|
| `founder_id`, `slot_date date`, `slot_time time null` | `slot_date` is in the founder's local calendar |
| `kind` enum `regular`, `reserved_timely`, `manual` | |
| `cadence_rule_id null` | Null for manual slots |
| `status` enum `open`, `filled`, `skipped` | `filled` when a draft is scheduled into it |
| `draft_id null unique` | One draft per slot, one slot per draft |

Unique `(founder_id, slot_date, ordinal)` makes slot generation idempotent.

**Three dates for a post** are kept separately:

- `drafts.proposed_date`: a suggestion, never counted as scheduled.
- `drafts.scheduled_for` (and the slot): committed. Only allowed when the draft
  is approved; check constraint plus transition function.
- `publications.published_at`: actual.

**Access:** admin has full access. A founder reads their own slots.

---

## 6. Research and insights

### `research_queries`
`brief_version_id null, concept_id null, query_text, provider, generation_run_id, created_by`.

### `research_sources`

| Column | Notes |
|---|---|
| `url`, `canonical_url` | Unique `(company_id, canonical_url)` so a source is stored once and reused |
| `title`, `publisher`, `author null` | |
| `published_at null`, `published_at_precision` (`day`, `month`, `year`, `unknown`) | Publication date of the *source* |
| `retrieved_at` | |
| `source_tier` enum `primary`, `reputable_publication`, `secondary`, `discussion`, `unknown` | |
| `excerpt text` | Short relevant excerpt only, not the full page (copyright and minimization) |
| `content_hash` | Detects changes on refetch |
| `provider`, `research_query_id` | |
| `status` enum `candidate`, `accepted`, `rejected` | Admin-reviewed |

### `research_findings`
A single claim or data point extracted from a source.

| Column | Notes |
|---|---|
| `source_id` | |
| `claim_text`, `quote text null` | The quote must appear verbatim in `excerpt` (checked in code) |
| `data jsonb null` | e.g. `{value: 27, unit: "%", population: "...", period: "2026"}` |
| `event_date null` | When the *event* happened, distinct from `published_at` |
| `verification_status` enum `unverified`, `machine_supported`, `human_verified`, `disputed`, `rejected` | `machine_supported` means "the excerpt contains it." Only a person sets `human_verified` |
| `verified_by null`, `verified_at null`, `notes` | |
| `conflicts_with uuid[]` | Findings that disagree |

### `integration_connections`
`provider enum('slack','linkedin')`, `external_account_id` (workspace id or member
URN), `founder_id null` (LinkedIn is per founder), `status enum('connected','error','revoked','disconnected')`,
`granted_scopes text[]`, `token_ref` (a Supabase Vault secret id, never the
token), `token_expires_at`, `refresh_expires_at`, `connected_by`,
`last_sync_at`, `last_error_code`, `last_error_at`. **Admin-only.** No founder
policy. Token columns are not selectable through the API role at all.

### `slack_channels`
`connection_id, slack_channel_id, name, is_private, enabled bool, enabled_by,
enabled_at, sync_cursor, last_synced_at, sensitivity_default`. A channel is
read only if `enabled`. Enabling is an audited admin action.

### `slack_messages` (short-lived working set)
`channel_id, ts, thread_ts, slack_user_id, founder_id null, permalink,
text, fetched_at, purge_after, flags text[]`.

Rows are purged after extraction plus a retention window (default 30 days,
D-09). Only `permalink`, `ts` and `channel` are retained, through
`insight_sources`. Messages flagged sensitive by the pre-filter are not
stored at all, only counted.

### `insights`

| Column | Notes |
|---|---|
| `founder_id null` | Whose perspective, if any |
| `source_kind` enum `slack`, `manual`, `meeting_note` | Manual entry works without Slack |
| `kind` enum `opinion`, `observation`, `story`, `recurring_problem`, `industry_insight` | |
| `summary`, `quote null` | Quote only with the founder's consent to quote (`quote_approved bool`) |
| `sensitivity` enum `none`, `customer_confidential`, `personal`, `hr`, `credential`, `other` | Anything but `none` cannot be approved |
| `review_status` enum `candidate`, `approved`, `excluded` | Generation reads `approved` only |
| `reviewed_by`, `reviewed_at`, `exclusion_reason` | |

### `insight_sources`
`insight_id, slack_channel_id, message_ts, permalink, author_slack_user_id`.
This is the provenance link, kept after the message text is purged.

---

## 7. Content: concepts, drafts, versions

### `concepts`

| Column | Notes |
|---|---|
| `founder_id`, `brief_version_id`, `generation_run_id null` (null if typed by hand) | |
| `title`, `audience`, `core_argument`, `hook`, `format`, `theme` | |
| `why_this_founder`, `evidence_requirements` | |
| `fingerprint jsonb` | topics, argument_key, hook_type, format, audience, product_mentions, cta (PRODUCT_SPEC §6) |
| `status` enum `proposed`, `selected`, `drafted`, `rejected`, `archived` | |
| `target_month date` | |

`concept_evidence`: `concept_id, finding_id null, insight_id null, note`.
Exactly one of `finding_id` or `insight_id` is set.

### `drafts`
The unit of workflow, scheduling and approval.

| Column | Notes |
|---|---|
| `founder_id`, `concept_id null` | A concept can have several drafts |
| `brief_version_id` | Copied from the concept at creation; changed only by explicit regeneration |
| `status` enum `drafting`, `admin_review`, `founder_review`, `changes_requested`, `approved`, `scheduled`, `published`, `rejected`, `archived` | |
| `current_version_id` | FK to `draft_versions` (deferrable) |
| `shared_with_founder_at null` | Founder RLS requires this to be set |
| `proposed_date null`, `scheduled_for timestamptz null` | |
| `is_external bool default false` | Recorded from LinkedIn without a studio approval; never counts as supply |
| `superseded_by_draft_id null` | |

Changing `status` is only possible through `app.transition_draft(draft_id,
to_status, reason)`. That function checks the role, the allowed transition
table and the preconditions (e.g. approval validity for `approved` to
`scheduled`, and the publish gate for `published`), then writes an audit event.
Direct `UPDATE` of `status` is revoked from the API roles.

### `draft_versions` (immutable)

| Column | Notes |
|---|---|
| `draft_id`, `version_no` | unique `(draft_id, version_no)` |
| `body text` | The LinkedIn post text only |
| `selected_hook_index null`, `alternative_hooks text[]` | |
| `body_normalized_hash bytea` | sha256 of the normalized body (PRODUCT_SPEC §7.4), computed by trigger |
| `author_kind` enum `ai`, `admin`, `founder` | |
| `created_by null` (null for AI), `generation_run_id null`, `parent_version_id null` | |
| `rationale text` | **Internal.** Excluded from the founder view unless marked shared |
| `voice_profile_version_id null` | |
| `placeholder_count int` | Count of `[FOUNDER TO SUPPLY` markers, computed by trigger |
| `fingerprint jsonb` | |

### `draft_claims`
`draft_version_id, claim_text, claim_kind enum('sourced_fact','opinion','interpretation','founder_experience'),
span_start, span_end, finding_id null, support_status enum('supported','weak','unsupported','disputed','not_applicable')`.

This is the source-to-claim-to-draft link. Traceability from a publication to
its sources is: `publications.approved_version_id → draft_claims.finding_id →
research_findings.source_id → research_sources.url`. Insights go through
`concept_evidence`.

### `review_flags`
`draft_version_id, kind enum('unsupported_claim','weak_evidence','needs_personal_context','competitor_claim','product_claim','repetition','sensitive_content','style'),
severity enum('blocking','warning','info'), message, span_start, span_end,
status enum('open','resolved','overridden'), resolved_by, resolution_note,
visible_to_founder bool`.

When a new version is created, open flags are re-evaluated for that version.
Flags belong to a version, so old flags never silently apply to new text.

---

## 8. Review, approval, feedback

### `approvals` (insert-only; only invalidation columns may change, via function)

| Column | Notes |
|---|---|
| `draft_id`, `draft_version_id` | |
| `body_hash` | Copied from the version at approval time |
| `approver_user_id`, `approver_role` | |
| `decision` enum `approved`, `rejected` | |
| `note` | |
| `invalidated_at null`, `invalidated_reason null`, `invalidated_by_version_id null` | |

**Valid approval for draft *D*:** a row where `draft_id = D`,
`decision = 'approved'`, `invalidated_at is null`,
`draft_version_id = D.current_version_id` and
`body_hash = (that version).body_normalized_hash`. It must be from the
required approver (D-11: the founder linked to `D.founder_id`).

A partial unique index allows at most one non-invalidated `approved` row per
draft.

**Invalidation:** a trigger on `INSERT INTO draft_versions` runs when the new
version's `body_normalized_hash` differs from the hash of the version holding
the current valid approval. It invalidates that approval, moves the draft back
to review, frees its slot and writes an audit event, all in the same
transaction.

### `comments`
`draft_id, draft_version_id, author_user_id, body, anchor jsonb null,
visibility enum('shared','admin_internal'), resolved_at`. Founders never see
`admin_internal` rows (RLS).

### `rewrite_requests`
`draft_id, requested_by, instructions, status, resulting_version_id,
generation_run_id`.

### `feedback_signals`
`founder_id, draft_version_id null, comment_id null, kind enum('stable_preference','format_preference','one_off','editorial_correction'),
statement, proposed_by enum('system','admin'), status enum('proposed','accepted','rejected'),
applied_voice_profile_version_id null, reviewed_by`. Only accepted
`stable_preference` and `format_preference` signals can feed a new voice
profile version, and only through an admin action.

### `repetition_checks`
`subject_type ('concept'|'draft_version'), subject_id, compared_type,
compared_id, method ('fingerprint','trigram','llm','embedding'), score,
explanation, created_at`.

### `repetition_overrides`
`subject_type, subject_id, compared_id, reason, overridden_by`. Audited.

---

## 9. Generation and cost

### `generation_runs`

| Column | Notes |
|---|---|
| `kind` enum `concept_batch`, `concept_regen`, `draft`, `draft_regen`, `rewrite`, `research`, `finding_extraction`, `insight_extraction`, `fingerprint`, `repetition_judge`, `feedback_classification` | |
| `founder_id null`, `requested_by` | |
| `provider`, `model`, `prompt_template`, `prompt_template_version` | |
| `input_refs jsonb` | ids of the brief version, voice version, examples, findings and insights used. **Not** the full prompt by default (D-10) |
| `status` enum `queued`, `running`, `succeeded`, `failed`, `cancelled` | |
| `idempotency_key unique` | Prevents a double-click or retry from running twice |
| `attempt`, `error_code`, `error_message` (sanitized) | |
| `input_tokens`, `output_tokens`, `cache_read_tokens`, `search_requests`, `estimated_cost_usd` | |
| `started_at`, `finished_at` | |

### `cost_ledger` (or a view over `generation_runs`)
Monthly totals per company and per founder, checked before each run against
`settings.monthly_ai_budget_usd` and `settings.per_run_ceiling_usd`.

### `settings`
`company_id` primary key, plus model choices per task, budgets, batch sizes,
look-back window and retention periods. Admin-only.

---

## 10. Publishing and performance

### `publications`

| Column | Notes |
|---|---|
| `draft_id unique` | One publication per draft (idempotency) |
| `approved_version_id null` | Null only for `is_external` |
| `approval_id null` | |
| `method` enum `manual`, `linkedin_api` | |
| `published_at`, `linkedin_url null`, `external_post_id null` (unique when present) | |
| `published_text`, `published_text_hash` | |
| `differs_from_approved bool`, `diff jsonb` | |
| `recorded_by` | |

Inserting is only possible through `app.record_publication(...)`. That function
applies the publish gate (PRODUCT_SPEC §8.1) unless `is_external`, sets the
draft to `published`, fills the slot and writes the audit event.

### `publish_attempts` (Phase 10)
`draft_id, attempt_no, provider, request_idempotency_key, status
enum('pending','succeeded','failed','unknown'), response_code, error, created_at`.
An `unknown` outcome (e.g. a timeout) blocks automatic retry until a person
reconciles it against LinkedIn, to avoid double-posting.

### `performance_snapshots`
`publication_id, captured_at, source enum('manual','linkedin_api'),
metrics jsonb` (impressions, reactions, comments, reshares, and so on, each
optional). Append-only time series.

---

## 11. Audit

### `audit_events` (append-only)
`company_id, occurred_at, actor_user_id null, actor_kind enum('user','system','job'),
action text` (e.g. `draft.transition`, `approval.invalidated`, `slack.channel_enabled`,
`repetition.override`, `user.invited`), `entity_type, entity_id, summary jsonb`.

`summary` holds ids, status changes and short reasons. It never holds tokens,
secrets, full Slack message text or full post bodies (bodies are already in
the versions). Insert only, through `security definer` functions and triggers.
There is no `UPDATE` or `DELETE` grant for any role, including through the
service role in app code (enforced by trigger).

**Access:** admin reads. Founders read events about their own drafts through a
filtered view (D-13).

---

## 12. Coverage calculation

### 12.1 Inputs
Founder *F*, period *P* (a set of calendar months), and `today` in *F*'s time
zone.

### 12.2 One status per draft, one bucket per draft
A draft has exactly one `status`, so every draft lands in exactly one bucket.
Concepts count only while they have no live draft. A *live* draft is one whose
status is not `rejected` or `archived`. External publications count only as
`published`, never as supply. That is the whole double-counting rule. It is
implemented as one SQL view, `app.coverage(founder_id, period_start, period_end)`,
which the dashboard, alerts and tests all use. There are no separate ad-hoc
counts.

### 12.3 Formulas

```
slots_target      = count(calendar_slots where founder=F, slot_date in P, status <> 'skipped')
slots_min/max     = same calculation with min_posts / max_posts patterns
published         = count(publications where draft.founder=F and published_at in P)
scheduled         = count(drafts where founder=F, status='scheduled',
                          scheduled_for in P, has_valid_approval(draft))
approved_unsched  = count(drafts where founder=F, status='approved', has_valid_approval(draft),
                          not is_near_duplicate_of_published(draft))
in_founder_review = count(drafts where founder=F, status='founder_review')
in_admin_review   = count(drafts where founder=F, status in ('drafting','admin_review','changes_requested'))
concepts_waiting  = count(concepts where founder=F, status='selected',
                          not exists live draft for concept)
excluded          = count(drafts where status in ('rejected','archived'))   -- display only

remaining_slots   = max(0, slots_target − published − scheduled)
usable_buffer     = approved_unsched
supply_gap        = max(0, remaining_slots − usable_buffer)
pipeline_after    = in_founder_review + in_admin_review + concepts_waiting   -- shown, never counted as supply

coverage_status   =
  'covered' if supply_gap = 0 and usable_buffer >= buffer_target
  'at_risk' if supply_gap = 0 and usable_buffer <  buffer_target
           or supply_gap > 0 and supply_gap <= pipeline_after
  'short'   otherwise, or if supply_gap > 0 and the next unfilled slot is within
            low_buffer_threshold days
```

A `scheduled` draft whose approval was invalidated is automatically moved out
of `scheduled` by the invalidation trigger. As a second line of defense,
`has_valid_approval()` is still required in the formula.

### 12.4 Replenishment need

```
candidates_existing = concepts(proposed|selected) + live drafts not yet approved
                      for target month
candidate_need      = max(0, candidate_target_max − candidates_existing − usable_buffer − scheduled)
batch               = min(candidate_need, settings.batch_size_concepts)
```

If `candidate_need = 0`, the dashboard says supply is sufficient and offers
no generation.

---

## 13. Indexes (initial)

- Every FK column.
- `drafts (founder_id, status)`, `drafts (founder_id, scheduled_for)`.
- `calendar_slots (founder_id, slot_date)`.
- `publications (published_at)`, and `draft_id` unique.
- `approvals (draft_id) where decision='approved' and invalidated_at is null`
  (partial unique).
- `research_sources (company_id, canonical_url)` unique.
- `generation_runs (company_id, created_at)`, `idempotency_key` unique.
- `audit_events (entity_type, entity_id, occurred_at)`.
- `pg_trgm` GIN on `draft_versions.body` and `concepts.core_argument`, for the
  repetition pre-filter.
- `tsvector` GIN on `writing_examples.search`.
- `pgvector` index only if embeddings are adopted (D-07).

---

## 14. Row-level security summary

RLS is **enabled on every table**, with deny by default.

| Table group | Admin | Founder |
|---|---|---|
| profiles | all in company | own row |
| founders | all | own row (limited update) |
| briefs / brief_versions | all | theme and own emphasis via view (D-13) |
| voice_profiles / versions | all | own: read |
| writing_examples | all | own: read, insert `approved_example` |
| cadence_rules, calendar_slots | all | own: read |
| research_* | all | read sources linked to their shared drafts |
| slack_*, integration_connections, settings, cost_ledger | all (token columns never selectable) | none |
| insights | all | none (D-13) |
| concepts | all | none (D-13) |
| drafts | all | own, where `shared_with_founder_at` is not null (grants exist in the schema but are unused in the MVP) |
| draft_versions, draft_claims | all | for visible drafts; `rationale` via a view that omits it |
| review_flags | all | `visible_to_founder` for visible drafts |
| approvals | read all; insert via function | read own drafts; approve via function |
| comments | all | `shared` on visible drafts; insert own |
| publications, performance_snapshots | all | own: read |
| generation_runs | all | none |
| audit_events | read | filtered view of own drafts |

State-changing actions (transition, approve, record publication, enable a
channel, invite) go through `security definer` SQL functions. Each one checks
`auth.uid()` and the role itself. Server code calls them with the **user's**
session (RLS applies), not with the service role.

The service-role or secret key is used only by background jobs that have no
user, such as sync and scheduled generation. Those jobs run fixed, reviewed
code paths, and they too write their changes through the same functions.

---

## 15. Migrations

- Migrations live in `supabase/migrations/NNNN_name.sql`, are applied with the
  Supabase CLI, and are forward-only. A mistake is fixed by a new migration.
- Each migration ships with pgTAP (or SQL-based Vitest) tests for its policies
  and functions (PHASES.md).
- Local: `supabase start` plus `supabase db reset` (applies all migrations and
  `seed.sql` with fake founders and content).
- Staging and production: migrations are applied by CI in the order main →
  staging → production. A migration is never hand-applied in the dashboard.
- Destructive changes (drop or rename a column with data) are two-step:
  1. Expand and backfill, and deploy that.
  2. Contract in a later release.
- Generated TypeScript types (`supabase gen types`) are committed and checked
  in CI.
