# Implementation Phases

Status: **Phase 0 proposal**, 2026-10-21. **No phase starts until the previous
one is reviewed and the user explicitly approves the next.** Phase 1 does not
start until these Phase 0 documents are approved.

Each phase is independently testable and leaves the application in a working
state.

**Every phase** includes these standing requirements in its definition of done:

- `npm run typecheck`, `npm run lint`, `npm run format:check`, `npm test` and
  `npm run test:db` pass. `npm run test:e2e` passes where the phase has E2E
  scope.
- RLS tests cover every new table: anonymous denied; founder A cannot touch
  founder B; founder cannot touch admin-only tables or columns.
- Migrations apply cleanly with `supabase db reset` from zero.
- No real Slack, LinkedIn or paid AI or search calls in automated tests.
- Docs updated: DATA_MODEL for schema changes, DECISIONS for decisions made,
  README status table.
- A short phase report listing:
  - what was built;
  - test commands and their results;
  - anything skipped and why;
  - open questions.

---

## Execution order (agreed 2026-10-21, D-19)

The order below differs from the order originally proposed. It was agreed on
2026-10-21 (D-19). Phase **names and numbers are unchanged**. Only the order of execution
moves.

| Step | Phase | Why here |
|---|---|---|
| 1 | Phase 1: Application foundation | Everything depends on auth, roles and RLS |
| 2 | Phase 2: Monthly strategy and cadence | Briefs and slots are inputs to generation |
| 3 | Phase 3: Founder voice and writing library | Voice is an input to generation |
| 4 | Phase 4: Content concepts and generation | First AI value |
| 5 | **Phase 7: Review and approval portal** (moved up) | Generated drafts are useless until they can be reviewed and approved. The approval-invalidation rule is the core safety property, so it should exist before more content-producing features are added |
| 6 | Phase 5: Industry research | Raises draft quality; drafts already flag unsupported claims without it |
| 7 | **Phase 9: Assisted publishing and reporting** (moved up) | Completes the loop to a published post, making the MVP usable end to end |
| 8 | Phase 8: Pipeline management | Its dashboard needs real publication records to be meaningful |
| — | **MVP complete**: production go-live (§Go-live) | Value delivered with no Slack or LinkedIn |
| 9 | Phase 6: Slack integration (moved later) | The highest privacy risk and pending terms questions; not needed for the MVP |
| 10 | Phase 10: LinkedIn publishing and analytics | Depends on API access and terms that are not yet verified |

The original order (1→10) would also have worked, but drafts produced in
Phases 4–6 would have sat in `admin_review` until Phase 7, and the MVP would
not have been usable end to end until Phase 9.

---

## Phase 1: Application foundation

> **Status (2026-10-21): built and tested locally.** Criteria 1–5 met.
> Criterion 6 (protected staging deploy) and the restore drill wait on the
> staging resources. See [the Phase 1 report](phase-reports/phase-1.md).

**Goal.** A secure, empty application: invite-only login, two roles, founder
profiles, a protected dashboard, the migration and test toolchain, and a
protected staging deployment.

**Scope**

- Repository scaffold (D-01): Next.js (version per the current repo standard),
  TypeScript strict, ESLint, Prettier, Vitest, Playwright, Supabase CLI.
- Supabase local stack; migrations for `companies`, `profiles`, `founders`,
  `founder_visibility_grants`, `audit_events`, `settings`, and helper functions
  `app.is_admin()` and related.
- Supabase Auth: sign-ups disabled; invites restricted to `@autograff.ai`
  (invite function plus "before user created" hook); admin invite flow (server-only); sign-in
  with email link or OTP; callback route; sign-out; deactivate user.
- Admin TOTP MFA enrollment and an AAL2 requirement on admin routes.
- `proxy.ts` session refresh and redirect; per-request `requireUser()` /
  `requireAdmin()` guards; security headers; `noindex`.
- Admin: founders list, create and edit founder profile (role title, time
  zone, LinkedIn URL), invite founder and link the account.
- Founder: empty dashboard showing their own profile.
- Audit events for invite, role change, deactivate and sign-in.
- `.env.example`, a `seed.sql` with fake company, admin and three founders, and
  a README runbook.
- CI: typecheck, lint, format, unit and database tests on pull requests.
- Staging: Vercel project with Deployment Protection on previews, connected to
  a **staging** Supabase project. **No production deployment and no DNS
  change.**

**Dependencies:** D-01, D-02 and D-04 are decided. A person must first:

- create the new repository;
- add a project in the existing Vercel Pro team;
- create the staging Supabase project (Free plan, D-21);
- create the staging SMTP sender (free tier).

**Budget:** $0 of new spend in this phase. The production Supabase project is
created only at go-live.

**Exclusions:** briefs, cadence, content, AI, integrations, production domain.

**Acceptance criteria**

1. Public sign-up is impossible. Calling the sign-up endpoint directly fails.
   Inviting or creating a user with a non-`@autograff.ai` address fails.
2. Admin can invite a founder. The founder accepts, signs in and sees only
   their own profile.
3. Every page except sign-in and callback redirects an anonymous user to
   sign-in.
4. An admin without MFA cannot reach admin pages.
5. A founder cannot read other founders' profiles, change their own role or
   read `audit_events` or `settings`, through the UI **or** the Supabase API
   with their own JWT.
6. The staging preview asks for Vercel authentication before the app login.

**Tests**

- Unit: guard helpers, role parsing, invite domain check, env validation (missing secrets fail
  fast server-side; no secret in `NEXT_PUBLIC_*`).
- Database: RLS for each table (anon, founder A vs B, founder vs admin
  tables); role self-update blocked; audit insert-only.
- E2E: invite → accept → sign in → see own dashboard; anonymous redirect;
  founder blocked from `/admin`.

**Definition of done:** standing requirements met; staging deploy reachable
only behind protection; restore of a staging backup or export tested once.

---

## Phase 2: Monthly strategy and cadence

**Status:** built and tested locally, 2026-10-21. See the
[Phase 2 report](phase-reports/phase-2.md).

**Goal.** The admin can write versioned monthly briefs and configure each
founder's cadence. The system computes publishing slots and initial coverage
for any month.

**Scope**

- `monthly_briefs`, `brief_versions` (immutable), brief editor with structured
  fields, version history and diff, founder emphasis blocks, approved facts.
- `cadence_rules` (effective-dated), editor, defaults for CTO (2/month) and
  CEO/COO (2–3/week) entered as seed data, not as code constants.
- `calendar_slots`: deterministic, idempotent slot generation per founder and
  month; reserved timely slots; manual add, move and skip of open slots.
- Calendar view (month, per founder, combined).
- `app.coverage()` view, the initial version with slots and the draft buckets
  wired, but returning zero until drafts exist. TypeScript mirror in
  `domain/coverage`.

**Dependencies:** Phase 1.

**Exclusions:** content generation, voice, research, scheduling of actual
drafts (only slots).

**Acceptance criteria**

1. Saving a brief creates v(n+1). Earlier versions stay readable and unchanged.
2. For a given rule and month, slot generation matches hand-computed fixtures
   and is idempotent (running it twice gives the same rows).
3. Changing a cadence rule from date D regenerates only open slots on or after
   D. Filled or past slots are untouched and reported.
4. Coverage shows required slots (min, target and max) per founder per month.

**Tests (named fixtures)**

- CEO 2–3/week in a month starting on a Sunday; in a month starting on a
  Saturday; February in a non-leap and a leap year; a 31-day month with five
  partial weeks.
- An ISO week spanning two months contributes slots only to the month of each
  slot date.
- `weekly_pattern [3,2]` alternation across a month boundary.
- Founder time zone across a DST change (America/Los_Angeles, Europe/London).
- CTO 2/month spread on preferred days; a month where a preferred day occurs
  only 4 times.
- Reserved timely slots reduce regular slots but not the target.
- A cadence change mid-month; overlapping rules rejected by the constraint.
- The SQL coverage view and the TypeScript function agree on the same fixtures.

**Definition of done:** standing requirements met; fixtures documented in
`tests/fixtures/cadence/README.md`.

---

## Phase 3: Founder voice and writing library

**Goal.** Each founder has an inspectable, editable, versioned voice profile
and a library of writing examples that can be retrieved by relevance.

**Scope**

- `voice_profiles`, `voice_profile_versions`, profile editor with version
  history and change reason.
- `writing_examples`: manual add and paste, bulk paste of published LinkedIn
  posts (text plus URL plus date), approve-for-voice toggle, tags and format.
- Retrieval: full-text plus format and topic match plus recency, returning the
  top N examples for a given concept. Pure and deterministic, so it is
  testable.
- `feedback_signals` table and admin review UI. Signals are created by hand in
  this phase; automatic proposals come in Phase 7.
- An optional "draft a voice profile from examples" AI action. Its output is a
  **proposal** the admin edits and saves. It may come in Phase 4 once the AI
  layer exists.

**Dependencies:** Phase 1.

**Exclusions:** generation, Slack excerpts.

**Acceptance criteria**

1. The admin can create and edit a profile, and every save creates a version.
2. A founder can read their own profile and examples, not other founders'.
3. Retrieval returns only `approved_for_voice` examples for that founder,
   ordered as specified.
4. Accepting a feedback signal requires an admin action and records which
   profile version it produced.

**Tests:** retrieval ranking on fixtures; version immutability; RLS; signals
of kind `one_off` or `editorial_correction` can never be applied to a voice
profile.

**Voice-quality evaluation (initial).** Create an evaluation set: per founder,
5–10 approved examples held out from retrieval. The test harness checks that
the prompt builder includes the profile and the retrieved examples. Real
model scoring of voice match is a **manual or opt-in** evaluation script
(`npm run eval:voice`), not part of CI.

**Definition of done:** standing requirements met; at least one founder's real
examples loaded in staging, if the founder consents.

---

## Phase 4: Content concepts and generation

**Goal.** Generate concept batches and drafts with full traceability, cost
control, versioning and repetition checks.

**Scope**

- `LlmProvider` interface, Anthropic implementation, fake implementation.
  Model per task from `settings`.
- `generation_runs`, job table and runner (`/api/jobs/tick` plus post-response
  start), idempotency keys, retries, sanitized errors, cost estimate and
  ceilings.
- Prompt templates (versioned) for concepts, drafts, fingerprints and the
  repetition judge.
- Concept batch generation per founder (respecting candidate targets);
  select, edit, reject and regenerate a single concept.
- Draft generation from a concept: structured output (body, alternative
  hooks, claims, flags, rationale), placeholder rule, post-generation lint
  (metadata leakage, banned phrases, paragraph shape).
- `drafts`, `draft_versions` (immutable), `draft_claims`, `review_flags`,
  `concept_evidence` (insights and findings may be empty for now).
- Version history and diff UI for the admin.
- Repetition checks: fingerprints, a trigram pre-filter, a model judge on the
  shortlist; warnings and overrides with a reason.
- Draft state machine `app.transition_draft()` limited to `drafting`,
  `admin_review`, `rejected` and `archived`. Later phases enable the rest.

**Dependencies:** Phases 2 and 3; D-06b (models); an Anthropic API key for
staging, with the $10 staging ceiling (D-21) and, if the Console supports it,
a matching spend limit on the Anthropic side.

**Exclusions:** web research (claims are flagged `unsupported` unless backed
by approved facts in the brief), founder review, publishing, Slack.

**Acceptance criteria**

1. A concept batch for one founder records the brief version, the voice
   version, the examples used, the model and the cost.
2. Regenerating one concept or draft leaves all others untouched; previous
   versions remain.
3. The post body never contains rationale, flags or source lists (lint plus
   test).
4. A draft that needs a personal story contains a `[FOUNDER TO SUPPLY: …]`
   placeholder and a blocking flag.
5. Every factual claim not backed by an approved fact or finding is flagged.
6. Seeded near-duplicates trigger a repetition warning; an override needs a
   reason and is audited.
7. A run that would exceed the per-run or monthly ceiling is refused before
   calling the API. The dashboard shows month-to-date spend and warns at 80%
   of the ceiling.
8. Double-submitting the same generation creates one run.

**Tests:** all against the fake provider: structured-output validation and
rejection paths; idempotency; retry on 429/5xx and no retry on 400; budget
refusal; lint rules; state machine transitions (allowed and forbidden);
repetition pre-filter on fixtures. An opt-in `npm run eval:generation` runs
real calls on a fixed set with a hard cap, never in CI.

**Definition of done:** standing requirements met; a manual quality review of
about 10 staging drafts per founder, recorded in the phase report.

---

## Phase 5: Industry research

**Goal.** Collect current, credible evidence with provenance and link it to
the claims in drafts.

**Scope**

- `ResearchProvider` interface; default implementation per D-06; fake.
- `research_queries`, `research_sources`, `research_findings`; tool-less
  extraction; validation that quotes and numbers are in the excerpt and URLs
  came from the provider.
- Research review UI: accept or reject sources, verify or dispute findings,
  link conflicting findings, show publication date vs event date vs retrieval
  date.
- Concepts and drafts use accepted findings. `draft_claims.finding_id` is
  linked, `support_status` is computed, and unsupported claims are flagged.
- Domain allow and block lists in `settings`.

**Dependencies:** Phase 4; verification checklist items 10–11.

**Exclusions:** Slack; automatic "truth" judgments (human verification
remains).

**Acceptance criteria**

1. Each stored source has URL, title, publisher (if known), published date or
   "unknown," retrieval date and excerpt.
2. A model-produced finding whose quote or number is not in the excerpt, or
   whose URL was not returned by the provider, is rejected.
3. A draft shows each claim with its source, or a flag. Founders see the
   sources for their shared drafts.
4. A prompt-injection fixture ("ignore previous instructions…" inside a page)
   does not change the extraction output schema, add URLs or trigger any
   action.

**Tests:** extraction validators; injection fixtures; date handling; RLS on
research tables; provider fake with recorded fixtures.

**Definition of done:** standing requirements met; research cost visible in
the cost ledger.

---

## Phase 6: Slack integration

**Goal.** Turn selected Slack conversations into reviewed, provenance-linked
founder insights without broad ingestion.

**Scope**

- Slack app (internal, bot token, minimum scopes per INTEGRATIONS §4.2), OAuth
  install with `state`, Vault token storage, disconnect and revoke, and
  uninstall or revoke event handling.
- Channel picker; enable and disable per channel (audited); only enabled
  channels are synced.
- Manual and scheduled sync with cursors and rate-limit handling; thread
  fetch for relevant messages only.
- Pre-filter, extraction, sensitivity classification, insight review queue,
  provenance (permalink), retention purge job.
- Integration health panel.

**Dependencies:** D-17 (terms review), an approved channel list, the workspace
admin's install approval, verification item 12, and the Phase 4 job runner.
Ideally a test Slack workspace for staging.

**Exclusions:** DMs, multi-person DMs, writing to Slack, file ingestion,
Events API (optional later).

**Acceptance criteria**

1. Nothing is fetched from a channel that is not enabled.
2. Messages matching the secret or PII patterns are not stored.
3. No insight can be used in generation until an admin approves it; sensitive
   classes cannot be approved.
4. Each insight links to its Slack permalink, author and timestamp.
5. Message text is purged after the retention window; insights remain.
6. Disconnecting revokes the token, deletes it from Vault and stops sync.
7. `not_in_channel`, `missing_scope`, `ratelimited` and `invalid_auth` errors
   surface in health without crashing other jobs.

**Tests:** fake Slack client with recorded fixtures (pagination, threads,
edits, deletes, rate-limit responses); pre-filter unit tests; RLS (founders
cannot read Slack tables); retention job; token never logged (log-capture
test).

**Definition of done:** standing requirements met; a security review of the
OAuth and token code, recorded in the phase report.

---

## Phase 7: Review and approval portal

**Goal.** Admin curation and founder review with versioned edits, comments,
rewrite requests, approval bound to exact versions, and invalidation on
material edits.

**Scope**

- Full draft state machine (`founder_review`, `changes_requested`,
  `approved`, `scheduled` reserved for Phase 9 or 8).
- Admin: edit, share with founder (sets `shared_with_founder_at`), return for
  revision, reject, archive and restore; choose which flags are visible to the
  founder.
- Founder: review screen (post, sources, shared flags), edit (new version),
  anchored comments, rewrite request (generation run with instructions),
  approve and reject.
- `approvals` with hash binding; `app.approve_draft()` that enforces "no
  blocking flags, no placeholders, approver is the linked founder";
  invalidation trigger.
- Comments (shared vs admin-internal), `rewrite_requests`, version diff for
  founders.
- Automatic proposal of feedback signals from edits (classified, pending admin
  review).
- Notifications by email for "shared with you" and "approved" (optional, D-20).

**Dependencies:** Phase 4.

**Exclusions:** scheduling and publication recording (Phase 9).

**Acceptance criteria**

1. A founder sees only drafts shared with them; admin-internal comments and
   rationale are never returned to a founder (API-level test).
2. Approval records approver, version, hash and time.
3. **Material-edit rule:** any change to the normalized body after approval
   invalidates the approval in the same transaction and returns the draft to
   review; whitespace-only normalization changes and metadata changes do not.
4. Approval is impossible with an open blocking flag or a placeholder.
5. A draft with zero flags is still not approved until a person approves it.
6. A rewrite request produces a new version and keeps all old versions.

**Tests:** normalization table tests (CRLF, trailing spaces, NFC vs NFD,
emoji, hashtag change, paragraph-break change); invalidation trigger tests
including concurrent edit and approve; state-machine matrix (role × from ×
to); RLS cross-founder; E2E: admin shares → founder edits → approves → admin
edits → approval invalidated.

**Definition of done:** standing requirements met; the founders try the
review flow in staging with fake drafts and give feedback.

---

## Phase 8: Pipeline management

**Goal.** One dashboard that tells the admin whether each founder has enough
approved content for the cadence, and helps fix shortfalls.

**Scope**

- Coverage dashboard per founder and period (every measure in PRODUCT_SPEC
  §4.4) from `app.coverage()`.
- Buffer status, shortfall flags against thresholds, "next unfilled slot" and
  replenishment suggestions (DATA_MODEL §12.4) with a confirm-then-generate
  action.
- Diversity report: distribution of topics, formats, hooks, audiences,
  product mentions and CTAs per founder and across founders for a month;
  repetition hot spots.
- Combined calendar with filters.

**Dependencies:** Phases 2, 4, 7 and 9 (publication records).

**Exclusions:** performance analytics.

**Acceptance criteria**

1. Fixture with drafts in every state: each draft counted exactly once;
   rejected, archived, external, pending and duplicate-of-published items
   never counted as supply.
2. Invalidating the approval of a scheduled draft immediately changes coverage
   (scheduled −1, slot open).
3. Shortfall triggers when buffer < threshold; replenishment proposes no more
   than the batch size and nothing when supply is sufficient.
4. No action on this page publishes or approves anything.

**Tests:** coverage property tests (random draft sets: sum of buckets = live
drafts; no item in two buckets); SQL vs TypeScript parity; threshold
boundaries; E2E: dashboard shows a shortfall, admin generates a replenishment
batch through the fake provider.

**Definition of done:** standing requirements met.

---

## Phase 9: Assisted publishing and reporting

**Goal.** Close the loop: schedule approved posts, copy the exact approved
text, record what was actually published, and report on it.

**Scope**

- Scheduling: assign an approved draft to a slot or date (`scheduled`);
  reschedule without touching approval; unschedule.
- Copy-to-clipboard of the approved version (fetched from the server).
- `app.record_publication()` enforcing the publish gate: date and time,
  LinkedIn URL, actual published text, diff vs approved version.
- External publication records (posted outside the studio) for repetition
  and reporting only.
- Published posts automatically become writing examples (configurable).
- Manual performance metric entry (`performance_snapshots`).
- Initial reports: published per founder per month vs cadence, themes and
  formats published, and manually entered metrics by theme, format and
  founder.

**Dependencies:** Phase 7.

**Exclusions:** LinkedIn API.

**Acceptance criteria**

1. An unapproved draft, or one whose approval is invalidated, cannot be
   scheduled or recorded as published. This holds through the UI **and**
   through a direct RPC call with an admin JWT.
2. Rescheduling keeps the approval; editing the text does not.
3. Copied text equals the approved version byte for byte (after
   normalization).
4. A publication record stores URL, date and actual text; a differing text
   shows a diff and an audit event.
5. A second publication for the same draft is rejected.

**Tests:** publish-gate database tests (every invalid precondition); E2E
schedule → copy → record; clipboard content test; report queries on fixtures.

**Definition of done:** standing requirements met; **MVP acceptance criteria
(PRODUCT_SPEC §12) all pass** in staging.

---

## Go-live (after the MVP; requires explicit approval)

1. Explicit approval to go live. Then a person creates the production
   resources (new spend: about $25/month for Supabase, plus AI usage capped at
   $50; D-21): Supabase production project, Vercel production environment
   variables, production SMTP sender, Anthropic production key with budget.
2. Configure auth per ARCHITECTURE §7.2; apply migrations in CI; seed company
   and admin only.
3. The user adds the `studio` CNAME (ARCHITECTURE §7.1, D-14); confirm TLS; confirm
   `noindex`; run a security smoke test (anonymous access, cross-founder
   access, headers).
4. Invite founders. Backup and restore drill on production backups.
5. Rollback plan rehearsed (Instant Rollback to the previous deployment).

---

## Phase 10: LinkedIn publishing and analytics

**Goal.** If, and only if, access and terms allow, publish approved posts to
founders' LinkedIn profiles and collect permitted metrics.

**Scope**

- **10a, verify:** terms review (D-18); developer app; Share on LinkedIn and
  OpenID Connect; test with one consenting founder; document real token
  lifetime and limits. **Stop here if terms or access do not allow it.**
- **10b, publish:**
  - per-founder OAuth connection (Vault);
  - `PublishingProvider` LinkedIn implementation;
  - "publish now" for approved posts, behind the publish gate, a
    confirmation step, a kill switch and a feature flag per founder;
  - `publish_attempts` with idempotency and manual reconciliation of unknown
    outcomes;
  - store the post URN and URL;
  - token expiry reminders.
- **10c, analytics:** if Community Management access is granted,
  `memberCreatorPostAnalytics` sync into `performance_snapshots`. Otherwise
  keep manual entry. Reports compare themes, topics, formats, hooks, founders
  and timing, and are labeled "engagement is one input." No automatic voice
  profile changes.

**Dependencies:** Phase 9; D-18; verification item 13; founder consent.

**Exclusions:** company page posting, comments and replies, DMs, scheduled
unattended posting unless D-18 explicitly permits it.

**Acceptance criteria**

1. Only drafts passing the publish gate can be queued.
2. A retry after an unknown outcome never posts twice without a person
   confirming.
3. A token expiry or API failure leaves the post scheduled with a "publish
   manually" prompt.
4. Revoking a founder's connection stops all publishing for them immediately.

**Tests:** fake LinkedIn provider covering success, 401 (expired), 403
(scope), 422, 429, timeout and unknown outcome; gate tests; kill switch; no
real posts in CI. A single manual verification post is done by a person and
recorded.

**Definition of done:** standing requirements met; terms review recorded;
manual fallback still works.
