# Decisions, Assumptions and Open Questions

Status: **Phase 0**, 2026-10-21. Each decision has a status:

- **Proposed:** a recommendation awaiting the user's approval.
- **Open:** needs input; no recommendation would be honest without it.
- **Accepted:** approved by the user (with date).

Decisions accepted on 2026-10-21 are marked **Accepted** with the user's answer.

---

## 1. Verified facts, assumptions, and unverified external facts

### 1.1 Verified in this session

- The repository is `autograff-site`, which holds the marketing site and the
  revenue-ops pipeline. It is not empty. Root `CLAUDE.md`, `README.md` and
  `docs/` exist and are owner-gated by `.github/CODEOWNERS` (ARCHITECTURE §1).
- The site uses Next.js 16 (`proxy.ts` replaces middleware), React 19,
  Supabase (`@supabase/ssr`, service-role data path), Vercel cron jobs, and a
  Slack *incoming webhook*. There is no Slack OAuth app and no LinkedIn
  integration.
- `.gitignore` ignores `.env*`. An exception was added for
  `studio/.env.example` only.
- Claude model IDs and list prices, per the Claude API reference bundled with
  Claude Code (cached 2026-10-06).

### 1.2 Unverified external facts

All Vercel, Supabase, Slack, LinkedIn and research-provider statements in these
documents are marked **[S]**. They come from search summaries of official
pages; the network policy blocked opening the pages themselves on 2026-10-21.
INTEGRATIONS §8 lists what must be verified, and when.

### 1.3 Assumptions

| # | Assumption | If wrong |
|---|---|---|
| A-1 | One company (Autograff), three founders (CEO, CTO, COO), one admin initially | The data model supports more; only seed data changes |
| A-2 | The admin is a marketing manager who is not one of the founders | If the admin is also a founder, D-11 matters more (self-approval) |
| A-3 | Posts are text-only on LinkedIn personal profiles | Images or documents would add storage and approval of media |
| A-4 | Founders will review in the web app, not by email or Slack | Would need a different notification and approval channel |
| A-5 | Volumes stay around 25–30 published posts a month | Larger volumes affect cost and job design, but not the schema |
| A-6 | Founders consent to their writing, and to selected Slack messages, being used for their voice profiles | Without consent, Phase 3 uses only what each founder approves; Phase 6 does not proceed |
| A-7 | English (US) is the posting language | Voice profiles would need a language field |
| A-8 | Autograff has a LinkedIn Company Page it can verify | Required for any vetted LinkedIn API access |
| A-9 | Posting times are at the founder's or admin's discretion. No automated "best time" optimization is in the MVP | — |

---

## 2. Decisions

### D-01: Where Studio lives. **Accepted 2026-10-21:** a new private repository (`autograff-studio`)

- **Context.** `autograff-site` is the production marketing site plus the
  revenue pipeline. Merges to `main` deploy autograff.ai. Its root
  `CLAUDE.md`, `docs/`, `supabase/` and `package.json` are owner-gated.
- **Options:**
  1. **New repo** (recommended). Independent deploys, permissions, CI,
     dependencies and CLAUDE.md. No risk to the marketing site's build or
     production. It is a clean place for founder-private code and
     configuration.
  2. A `studio/` app inside this repo (monorepo with npm workspaces). It shares
     tooling, but couples builds, CODEOWNERS and secrets, and would need
     owner review on root config changes.
  3. Routes inside the existing site app (`/studio`). Rejected: it mixes
     private founder data into the public site's deployment, Supabase project
     and secrets.
- **Consequences.** Phase 0 documents are in `studio/` here only for review.
  Now that D-01 is accepted, the folder moves verbatim to the new repo's root
  (`studio/CLAUDE.md` → `CLAUDE.md`, and so on), and the `studio/` folder and
  its `.gitignore` exception are removed from this repo.

### D-02: Database separation. **Accepted 2026-10-21:** new Supabase projects (production and staging), not the existing pipeline project

- **Why.**
  - The pipeline project holds CRM, call and lead data, and its service-role
    key is present in the site's environment.
  - Founder drafts and Slack text should not share that blast radius or those
    credentials.
  - Separate projects also give separate Auth user pools: founders do not
    become users of the pipeline project.
- **Staging.**
  - Option A: a Pro project (does not pause).
  - Option B: a Free project that may pause after about 7 days idle [S].
  - Option C: Supabase Branching per preview, billed per branch-hour [S].
  - **Chosen under the budget (D-21): B.** Staging is a Free project and may
    pause when idle. Resuming it is a dashboard click.
  - Production is a paid project. If the organization that owns the pipeline
    project is already on a paid plan, adding a project there may cost only
    its compute rather than a second plan fee [S]. Check this in Phase 1. The
    separation that matters is per project: separate database, keys and Auth
    users.
- **Consequences.** One more paid project. No cross-database queries with the
  pipeline, which are not needed.

### D-03: Background processing. **Accepted 2026-10-21** (no extra vendor, fits the budget): a Postgres job table plus a Vercel Cron tick plus post-response start

- **Alternatives.** Inngest, Trigger.dev, Upstash QStash, Supabase queues or
  Edge Functions.
- **Why.** Low volume, no new vendor, and the same database transaction model.
- **Revisit if** jobs regularly approach function time limits, or if Slack
  sync volume grows.

### D-04: Authentication details. **Accepted 2026-10-21** (all founders use `@autograff.ai` addresses)

| Item | Decision |
|---|---|
| Sign-in method | Email magic link or OTP, invite-only |
| Allowed addresses | `@autograff.ai` only. Enforced in the invite function and, as a second check, in a Supabase "before user created" hook [S] |
| Admin MFA | Required (TOTP) |
| Founder MFA | Offered, not required at launch. Revisit before Phase 10 (LinkedIn connections) |
| Session | Supabase defaults; admins re-authenticate after 12 h idle |
| Email provider for auth mail | A free tier of a transactional provider (e.g. Resend or Postmark). Volume is a handful of emails a month. Chosen in Phase 1 |

Google Workspace SSO would also work now that everyone is on `@autograff.ai`,
if the domain is on Google Workspace. It is not needed: magic links plus the
domain restriction give the same boundary with less setup. It can be added
later without schema changes.

### D-05: Material-edit rule. **Accepted 2026-10-21:** any change to the normalized body is material

- **Normalization:** line endings, trailing whitespace per line, leading and
  trailing blank lines, Unicode NFC. Changing the selected hook is material.
  Dates, notes, tags and comments are not.
- **Alternative:** a lenient rule ("typo fixes under N characters do not
  invalidate"). Rejected for the MVP because it is ambiguous, gameable and
  hard to test, and a small edit can change meaning.
- **Consequence:** founders re-approve after any wording change. A
  "quick re-approve with diff" UI keeps that cheap.

### D-06: Research provider. **Accepted 2026-10-21 as the starting choice:** the Claude web search tool first, Brave Search as the alternative implementation

- Both sit behind `ResearchProvider`.
- Prices are [S] (INTEGRATIONS §3.2).
- **Input needed:** any existing subscription (e.g. Perplexity or Exa) or
  preferred industry sources and paywalled publications Autograff already
  pays for.

### D-06b: Drafting model. **Accepted as the starting default; reviewed after Phase 4:** `claude-opus-5-5` for drafts and concepts; `claude-sonnet-5-5` for extraction and classification

- Configurable per task.
- Decide after the Phase 4 quality review.

### D-07: Embeddings. **Accepted 2026-10-21:** not in the MVP

- Use trigram plus fingerprint plus a model judge.
- Revisit after Phase 8 if repetition detection misses cases.
- Adding embeddings means a new vendor and `pgvector`.

### D-08: Single-company scope. **Accepted 2026-10-21:** `company_id` on all rows; no tenant administration

The `company_id` columns cost little and keep a future second company
possible.

### D-09: Retention periods. **Accepted 2026-10-21 on recommendation** (all configurable in settings)

| Data | Default |
|---|---|
| Slack message text | 30 days |
| Generation run metadata | 24 months |
| Audit events | Indefinite |
| Rejected or archived drafts | Indefinite, with admin delete |
| Prompt and response bodies | Not stored (see D-10) |

Why: Slack text is the most sensitive data and is only needed long enough to
extract and review insights; the insight and its permalink survive. Run
metadata is kept long enough for cost and quality comparisons across a year.
Audit events are small and are the record of who approved what.

### D-10: Prompt storage and provider data handling. **Accepted 2026-10-21 on recommendation**

- **Decision:** do not store full prompts or responses. Store the ids of every
  input (brief version, voice version, examples, findings), the model, the
  template version and token counts, which is enough to reproduce a run. The
  admin can switch on a debug mode that keeps full prompts and responses for
  7 days, then deletes them automatically.
- **Why:** prompts contain founder writing and, later, Slack excerpts. Keeping
  them indefinitely adds risk and buys little, because the inputs are already
  versioned.
- **Before Phase 6:** confirm the Anthropic organization's data-retention
  settings are acceptable for Slack-derived text.

### D-11: Who approves before publishing. **Accepted 2026-10-21:** the founder's approval is required and sufficient; the admin "shares" but does not approve

- **Alternative:** require both admin and founder approval.
- **Alternative:** allow the admin to approve on a founder's behalf with a
  recorded delegation. **Not recommended:** it defeats the point of founder
  approval.
- **Input needed:** whether any founder wants to delegate approval to the
  admin.

### D-12: May founders record their own publications? **Accepted 2026-10-21:** not in the MVP

The admin owns the calendar. This can be enabled later per founder.

### D-13: What founders can see. **Accepted 2026-10-21:** each founder sees their own content only

| Item | Founder sees it? |
|---|---|
| Their own drafts, once the admin shares them | Yes |
| Their own calendar, approved and published posts | Yes |
| Their own voice profile and writing examples | Yes |
| Brief theme plus their own emphasis block | Yes |
| History of their own drafts | Yes |
| Their own concepts before drafting | No; concepts are admin curation |
| Admin-internal notes, rationale, cost, settings, integrations | No |
| Other founders' content of any kind | No |

The `founder_visibility_grants` table stays in the schema, so cross-founder
sharing can be added later, but the MVP has no UI for it and no grants.

### D-14: DNS ownership for autograff.ai. **Accepted 2026-10-21:** the admin (the user) makes the DNS changes

The user will add the `studio` CNAME and the email sender records (SPF, DKIM,
DMARC) at go-live, using the exact values the Vercel domain card and the email
provider show at that time (ARCHITECTURE §7.1). No DNS change happens before
go-live is approved.

### D-15: Which company style rules apply to founder posts. **Deferred to Phase 3** ("we can figure out the rules")

The marketing source of truth (`.agents/product-marketing.md`) sets rules for
company copy. Examples:

- no em-dashes;
- no unsourced numbers;
- pricing stated exactly, with conditions;
- no invented metrics.

The factual rules are not style. They always apply: no unsourced numbers,
exact pricing, no invented metrics or logos. Stylistic rules, such as
em-dashes, are agreed with each founder when their voice profile is built in
Phase 3, and stored there.

### D-16: Point-in-time recovery. **Decided 2026-10-21 by the budget (D-21): no PITR**

PITR is a paid add-on listed at about $100/month and up [S], which on its own
would use the whole budget. Instead: the paid plan's daily backups, plus a
weekly independent export, plus immutable versions in the app itself (most
mistakes are undone in-app, not by restoring the database).

### D-17: Slack terms and scope review. **Open**, blocking Phase 6

Someone must read the Slack API Terms and the App Developer Policy in full
regarding runtime LLM processing and storage (INTEGRATIONS §4.4). Then decide:

- the channel allow-list;
- whether private channels are in scope;
- who approves the app installation.

### D-18: LinkedIn API publishing. **Open**, blocking Phase 10

A terms review covering the API Terms ("automate posting") and the Developer
AI Policy, plus a decision on whether to pursue Community Management vetting
for analytics (INTEGRATIONS §5). Until then, publishing and metrics stay
manual.

### D-19: Phase execution order. **Accepted 2026-10-21:** 1, 2, 3, 4, 7, 5, 9, 8, then go-live, then 6, 10

- **Reasons** (PHASES.md):
  - The review and approval gate should exist as soon as drafts exist.
  - Assisted publishing completes the MVP loop.
  - Slack carries the most privacy and terms risk and is not needed for the
    MVP.
- **Implication:** the MVP ships without Slack-derived insights. Manual
  insights fill that gap.
- The user left this to the recommendation ("do what you think is right").

### D-20: Notifications. **Open**

Should founders get an email when a draft is shared with them, and should the
admin get one when a draft is approved? Recommendation: yes, through the same
SMTP provider, with links that require login and no draft text in the email.

### D-21: Budget. **Accepted 2026-10-21:** $100 per month, all in

Everything this product adds to Autograff's bills, including hosting, database,
email, AI and search, must stay at or under **$100/month**. Vercel Pro is
already paid for.

| Item | Plan | Monthly |
|---|---|---|
| Vercel | Existing Pro team; Studio is one more project | $0 extra [A]. Stays inside included usage at this volume |
| Supabase production | Paid project | ~$25 [S] (less if added to an already-paid organization) |
| Supabase staging | Free project; may pause when idle | $0 |
| Point-in-time recovery | Not purchased (D-16) | $0 |
| Auth email | Free tier of a transactional provider | $0 |
| Domain | Subdomain of autograff.ai | $0 |
| Slack, LinkedIn | No API fees known [A] | $0 |
| **AI + web search, production** | Hard ceiling enforced by the app | **$50** |
| **AI + web search, staging and local** | Hard ceiling enforced by the app; local uses fakes by default | **$10** |
| Headroom | Unplanned usage, price changes | ~$15 |
| **Total** | | **≤ $100** |

How the cap is enforced:

1. The app refuses any AI or search run that would take the month's spend in
   its environment over its ceiling, and refuses a single run over
   `AI_PER_RUN_CEILING_USD`. The dashboard shows month-to-date spend against
   the ceiling, with a warning at 80%.
2. As an outer safety net, set a monthly spend limit on the Anthropic account
   or workspace used by Studio. Confirm this option exists in the Anthropic
   Console during Phase 4 [A].
3. Anything that would need new spend (PITR, a paid search plan, a second paid
   database, embeddings) needs a new decision first.

Why $50 for production AI is enough: the estimate in ARCHITECTURE §10 is
about $16 for drafts plus a similar amount for concepts, extraction and
checks, plus a few dollars of search. That leaves room for regeneration.
If spend runs high, the levers are, in order:

- prompt caching;
- fewer regenerations per post;
- a cheaper model for concept batches;
- the Batch API for non-urgent batches (about half price) [V].

### D-22: Next.js Cache Components. **Decided in Phase 1 (2026-10-21):** off

- **Context.** Next.js 16.4 turns on `cacheComponents` by default. With it, a
  session read is meant to be cached per user for about five minutes
  (`use cache: private`) so navigations feel instant.
- **Decision.** Off. Every page in Studio is private and per-user, and the
  important property is that a role change or deactivation takes effect on
  the next request. Re-verifying the session on each request costs a few
  milliseconds at this scale. `partialPrefetching` requires Cache Components,
  so it is off too.
- **Consequence.** Every page renders per request (also needed for the CSP
  nonce). Revisit only if page speed becomes a problem.

### D-23: Where slot dates and coverage are computed. **Decided in Phase 2 (2026-10-21)**

- **Context.** The plan put coverage in one SQL view, and slot generation
  could live in SQL or TypeScript.
- **Decision.** Slot dates are computed by pure TypeScript
  (`lib/domain/cadence.ts`), which is unit-tested against hand-computed
  fixtures. The database still enforces the rules: `sync_calendar_slots`
  rejects any slot on a date with no rule in effect, only adds or removes
  open, future, cadence-generated slots, and is idempotent through the unique
  `(founder_id, slot_date, ordinal)` key. Coverage counts slots in SQL
  (`coverage_slot_counts`); the full formula lives in
  `lib/domain/coverage.ts` with the draft buckets at zero, and a test checks
  that both give the same counts. The single `app.coverage` view is built in
  Phase 4, when there are drafts to count.
- **Consequence.** Date arithmetic is tested where it is easiest to read and
  check, and planning cannot put a slot outside the cadence. Planning is an
  explicit admin action ("Plan slots for {month}"), also run automatically for
  the affected months when a cadence changes.

### D-24: Moving and skipping slots. **Decided in Phase 2 (2026-10-21)**

- **Decision.** Skipping keeps the row with status `skipped`, which does not
  count toward the month's required slots. Moving a cadence slot skips it and
  adds a manual slot on the new date. Manual slots can be removed; cadence
  slots can only be skipped. Only slots dated today or later can change.
- **Consequence.** Re-planning never brings back a slot the admin skipped or
  moved, and the history of what changed stays in the table and audit log.

### D-25: How writing examples are retrieved. **Decided in Phase 3 (2026-10-21)**

- **Context.** The plan called for full-text search plus format, topic and
  recency matching, and needs the result to be testable.
- **Decision.** Retrieval is a pure TypeScript function
  (`lib/domain/retrieval.ts`). It loads a founder's examples (tens to a few
  hundred) and scores each one:
  3 × same format + 2 × shared topics + 2 × shared words + 1 × recency
  (half weight after 180 days). Ties go to the newest, then the lowest id. The top
  5 are used. The database decides what *may* be retrieved: RLS limits rows to
  the founder, and only `approved_for_voice` examples that are not
  `eval_holdout` are candidates. There is no Postgres `tsvector` column; it
  would add an index to keep in step for no gain at this size.
- **Consequence.** The ranking is unit-tested on hand-computed fixtures
  (`tests/fixtures/retrieval/README.md`). The admin can see what generation
  would use on each founder's examples page. Revisit if a founder has thousands
  of examples.

### D-26: Voice profile details. **Decided in Phase 3 (2026-10-21)**

- **Style rules (D-15).** Each founder's agreed style rules, such as "No
  em-dashes", are a list on their voice profile and override the company
  default for that founder. The factual rules are not stored per founder,
  because they always apply.
- **Post formats** are one fixed list, shared by examples, format preferences
  and (from Phase 4) concepts: story, opinion, how-to, data insight, lesson
  learned, announcement, list, question, other.
- **Founder-shared examples.** A founder can share their own writing from
  their Voice page. It is saved as an `approved_example`, already approved for
  voice, because sharing it is their consent (A-6). Founders cannot edit
  their profile, other example settings, or feedback; they ask the admin.
- **Feedback.** One-off and editorial signals can be accepted (recorded only)
  or rejected. Stable and format preferences can be rejected, or accepted only
  by saving a new profile version with them. The signal then records that
  version. The database refuses any other link.
- **Evaluation set.** An approved example can be marked "held out for
  evaluation". It is then never retrieved, so it can be compared with
  generated drafts.
- **Deferred to Phase 4:** the `npm run eval:voice` model-scoring script and
  the optional "draft a profile from examples" AI action. Both need the LLM
  provider, which Phase 4 builds.

### D-27: Bringing in founders' LinkedIn posts. **Decided 2026-10-21:** import the founder's own data export

- **Context.** Pasting posts by hand is slow. LinkedIn's API does not offer
  reading a member's own posts without partner approval [S], and scraping
  breaks LinkedIn's user agreement.
- **Decision.** The admin uploads `Shares.csv` from the founder's own LinkedIn
  data export (Settings → Data privacy → Get a copy of your data). The file
  is parsed **in the browser**: only post text, link and date are sent, in
  batches of 50, and the rest of the export never leaves the device.
  - Reposts with no text of their own are skipped, and so are posts already
    in the library.
  - Only the post-commentary column is read. A file without one, such as
    the export's `messages.csv`, is refused, and the error lists the columns
    found.
- **Consequence.** Free, consented, and no LinkedIn app is needed. LinkedIn
  changes the export's column names from time to time. The parser matches
  several known names [S], and the error message lists the columns found so
  the parser can be updated. No scraping and no browser extension.

---

## 3. Inputs still needed from the user

1. **Before Phase 1:** where the new repository should be created (owner
   account or organization) and approval to create it; then approval to start
   Phase 1.
2. **Phase 1:** which Supabase organization owns the new projects, and which
   transactional email provider to use (free tier).
3. **Phase 3:** each founder's style rules (D-15), agreed with the founder, and
   entered on their voice profile.
4. **Before Phase 6:** who reads the Slack terms (D-17); which channels.
5. **Before Phase 10:** who does the LinkedIn terms review (D-18).

## 4. Change log

| Date | Change |
|---|---|
| 2026-10-21 | Phase 0 draft created |
| 2026-10-21 | Phase 1 built locally; D-22 added |
| 2026-10-21 | Phase 2 built; D-23, D-24 added |
| 2026-10-21 | Phase 3 built; D-25, D-26 added; D-15 implemented as per-founder style rules |
| 2026-10-21 | LinkedIn export import; D-27 added |
| 2026-10-21 | User answers recorded: D-01, D-02, D-04, D-11, D-13, D-14, D-19 accepted; D-09, D-10 accepted on recommendation; D-15 deferred to Phase 3; D-16 and D-21 set by the $100/month budget |
