# Autograff Content Studio: Product Specification

Status: **Phase 0 draft for review**, 2026-10-21. Nothing in this document is
built yet. Where a requirement depends on a decision that has not been made, it
points to the decision record in [DECISIONS.md](DECISIONS.md) (`D-xx`).

Companion documents: [ARCHITECTURE.md](ARCHITECTURE.md),
[DATA_MODEL.md](DATA_MODEL.md), [SECURITY.md](SECURITY.md),
[INTEGRATIONS.md](INTEGRATIONS.md), [PHASES.md](PHASES.md).

---

## 1. Purpose

Content Studio is a private web application, planned for
`https://studio.autograff.ai`, where Autograff's marketing admin plans,
generates, curates and manages LinkedIn content for the company's founders.

It is a **content operations platform**, not a chatbot. Its job is to reduce
the manual work of publishing thoughtful, authentic, factually sound founder
content on a steady cadence. It has to do that while keeping each founder's own
voice and professional credibility intact.

It supports Autograff's marketing strategy without turning every post into a
product advertisement. Most posts should not mention Autograff's products at
all.

### 1.1 Operating principle: separate stages, traceable inputs

The workflow is split into nine stages. Each stage has an owner, recorded
inputs and explicit status transitions:

| # | Stage | Owner | Output | Recorded inputs |
|---|---|---|---|---|
| 1 | Strategy | Admin | Monthly brief version | Previous briefs, approved messaging |
| 2 | Research and insight collection | System, admin reviews | Research sources, findings, insights | Brief version, search queries, Slack channels |
| 3 | Content planning | System, admin selects | Concepts | Brief version, cadence, coverage, findings, insights, existing content |
| 4 | Draft generation | System | Draft version (AI) | Concept, brief version, voice profile version, examples, findings |
| 5 | Admin curation | Admin | Draft version (admin), "shared with founder" | Draft, review flags |
| 6 | Founder review | Founder | Edits, comments, rewrite requests | Draft, sources, flags |
| 7 | Approval | Founder (and admin, see §7.3) | Approval of one exact version | That version's content hash |
| 8 | Scheduling and publishing | Admin | Scheduled slot, publication record | Approved version, calendar |
| 9 | Performance and feedback | Admin, system | Metrics, feedback signals | Publication, permitted metrics |

No stage is collapsed into an opaque "generate everything" request. Each AI step
is a separate, logged **generation run** with its inputs and outputs stored
(DATA_MODEL §9).

---

## 2. Users and roles

The MVP serves one company, Autograff. Every row carries a `company_id`, so the
data boundary exists from day one. There is no multi-tenant administration
(D-08).

### 2.1 Admin (marketing manager)

Can:

- Create and version monthly briefs.
- Manage founder profiles, cadence rules and content buffers.
- Configure research and (later) Slack integrations.
- Review research sources and Slack-derived insights before they are used.
- Generate concepts and drafts, and regenerate either individually.
- Edit, approve, reject, archive and return drafts.
- Curate drafts before they are shared with a founder.
- Manage the publishing calendar and coverage for every founder.
- See every founder's content and approval state.
- Manage settings and integrations.
- Read the audit history and generation logs.
- Record posts published manually to LinkedIn.
- Invite and deactivate users.

### 2.2 Founder

Can:

- Sign in. Self-registration is disabled, so a founder can only accept an
  admin's invitation.
- See drafts **assigned to them** that the admin has shared, plus their
  supporting sources and the review flags the admin marks as shared.
- Edit those drafts (each edit creates a new version), comment, and request a
  rewrite.
- Approve or reject a specific version.
- See their own publishing calendar and approved content.

Cannot:

- See another founder's drafts, concepts, voice profile or calendar, unless the
  admin grants it explicitly (DATA_MODEL §3, `founder_visibility_grants`).
- See internal admin notes, generation rationale marked internal, cost data,
  integration settings or the audit log.
- Schedule or record publication. In the MVP, the admin owns the calendar; see
  D-12 for letting founders record their own publications.

These rules are enforced **in the database (row-level security) and on the
server**. Hiding a button is not access control (SECURITY §4).

### 2.3 Initial founders

Three founder profiles to start with, identified here by role only. Names, emails
and LinkedIn URLs are entered in the app, not in code.

| Founder | Default cadence | Approx. slots per month | Default candidates per month |
|---|---|---|---|
| CTO | 2 posts per calendar month | 2 | 4–6 |
| CEO | 2–3 posts per week | 8–13 | 16–20 |
| COO | 2–3 posts per week | 8–13 | 16–20 |

These are **editable defaults** stored as data, not constants in code. The
approximate slot counts are only for planning. The real figure is computed from
the cadence rule, the calendar month and the publishing days (§4.2).

The admin cannot approve on a founder's behalf (D-11, agreed 2026-10-21).

---

## 3. Monthly content strategy

### 3.1 Monthly brief

The admin creates one brief per calendar month. A brief has these structured
fields, and every field is optional except the theme:

- Overarching monthly theme, plus optional secondary themes.
- Business objectives.
- Target audiences.
- Core arguments and viewpoints.
- Product or company updates.
- Relevant industry developments.
- Desired content mix (formats and topic share, as guidance rather than quota).
- Topics to avoid.
- Calls to action, and how often they are appropriate.
- Relevant dates, events and launches.
- Previous themes and topics not to repeat (prefilled from earlier briefs and
  published posts).
- Founder-specific emphasis (one block per founder).
- Important facts, positioning and approved messaging. This links to approved
  facts, for example pricing as stated in the marketing source of truth. The
  generator may only quote prices, product claims and metrics that appear here.

### 3.2 Versioning

- Saving a brief creates a new **immutable brief version**. Earlier versions
  stay readable.
- Every concept and draft records the brief version that informed it.
- Publishing a new version **never rewrites** existing concepts, drafts or
  approved content. The UI shows "based on brief v2, current is v3" on items
  created from an older version. The admin can then regenerate, keep or
  archive them deliberately.

### 3.3 One theme, three perspectives

The theme guides content without forcing every post to make the same argument.
Concept generation is run per founder, using that founder's emphasis block,
expertise topics and voice profile. Concepts are checked against the other
founders' concepts for the month so that the CEO, CTO and COO approach the
theme from different angles. The examples in the original brief (CEO on work
progressing, CTO on prediction under changing conditions, COO on the cost of
unclear status) are illustrative only. They are not templates.

Timely industry developments and secondary themes are welcome when they serve
the strategy. Reserved "timely" slots (§4.3) make room for them.

---

## 4. Cadence, calendar and content coverage

### 4.1 Cadence rules

Each founder has a cadence rule, which the admin edits and which is versioned
by effective date:

- `period`: `week` or `month`.
- `min_posts`, `max_posts` per period (e.g. 2–3 per week; 2–2 per month).
- `weekly_pattern` (optional): an explicit pattern, e.g. `[3, 2]`, meaning
  alternating 3-post and 2-post weeks. If absent, the target per period is
  `max_posts` when filling ahead and `min_posts` for shortfall alerts (§4.4).
- `publishing_days`: preferred weekdays (e.g. Tue, Wed, Thu) and an optional
  preferred local time, in the founder's time zone.
- `reserved_timely_slots_per_month`: slots held back for news.
- `buffer_target`: how many approved, unscheduled posts to keep in hand.
- `low_buffer_threshold`: below this, flag a shortfall.
- `candidate_target_min` / `candidate_target_max`: candidate concepts per
  month (defaults per §2.3).
- `effective_from`: changes apply from this date forward.

**Changing a cadence never silently alters the past.** A new rule takes effect
from its `effective_from` date. Open future slots generated by the old rule are
regenerated. Slots that are filled, scheduled or published are left alone and
reported as "outside new cadence" for the admin to resolve by hand.

### 4.2 Slot calculation

For founder *F*, month *M*, and the rule(s) in effect on each day of *M*:

1. Work in the founder's time zone. A slot belongs to the calendar month that
   contains its date.
2. **Weekly rules:** enumerate ISO weeks that overlap *M*. For each week, the
   target is taken from `weekly_pattern` (indexed by ISO week number) or from
   `max_posts`. Assign that many slots to the week's preferred days, in order
   of preference, and keep only the slots whose date falls inside *M*. A week
   split across two months therefore contributes its slots to whichever month
   each slot date lands in. It never contributes to both.
3. **Monthly rules:** spread `max_posts` slots evenly across the preferred days
   of the month (e.g. CTO: 2 slots, roughly in weeks 2 and 4).
4. Subtract `reserved_timely_slots_per_month` from the regular slots and create
   that many `reserved_timely` slots instead. They count towards the target, but
   the system does not fill them with planned content automatically.
5. Report three numbers: **minimum** (from `min_posts`), **target**, and
   **maximum** (from `max_posts`). For the CEO in a month with four full weeks
   and one partial week, that is roughly 8–13.

Slot generation is deterministic and idempotent: re-running it for the same
rule and month yields the same slots. It does not duplicate or move filled
slots. Calendar-boundary cases (months starting mid-week, five-week months,
daylight-saving changes, a cadence change mid-month) are named test cases in
PHASES.md Phase 2.

### 4.3 Publishing calendar

- Founder-specific publishing days and weekly frequency, from §4.1.
- Calendar-month view per founder and combined.
- Manual add, move, skip and delete for open slots. Rescheduling a filled slot
  moves the draft's `scheduled_for`. **This does not touch its approval**,
  because the date is not part of the approved content (§7.4).
- Reserved timely slots, shown distinctly.
- Empty slots are allowed and shown as empty. **The system never fills a slot
  by auto-publishing or auto-approving content.**
- Three distinct dates per post: **proposed date** (a suggestion by the system
  or admin), **scheduled date** (committed by the admin, only for approved
  content) and **published at** (actual, recorded on publication).

### 4.4 Content coverage

For each founder and a selected period (default: the current and the next
calendar month), the dashboard shows:

| Measure | Definition (exact formulas in DATA_MODEL §12) |
|---|---|
| Slots required | Target slots in the period (with min–max range) |
| Published | Publications whose `published_at` falls in the period |
| Scheduled | Drafts in `scheduled` with a valid approval and a scheduled date in the period |
| Approved, unscheduled | Drafts in `approved` with a valid approval and no date |
| Awaiting founder review | Drafts in `founder_review` |
| Awaiting admin review | Drafts in `admin_review` or `changes_requested` |
| Concepts awaiting drafting | Concepts in `selected` with no live draft |
| Rejected / archived | Shown for information, never counted as supply |
| Remaining slots | Slots required − published − scheduled (floor 0) |
| Usable buffer | Approved, unscheduled (valid approval, not a near-duplicate of published content) |
| Coverage status | `covered`, `at risk` or `short` (rules in DATA_MODEL §12.3) |

Rules:

- Every draft is in **exactly one** status at a time, so it is counted once.
  A concept stops counting as soon as it has a live draft. That is how
  double-counting is prevented (DATA_MODEL §12.2).
- Rejected, archived, duplicate and already-published content never counts as
  available.
- A draft awaiting approval is **pipeline**, not supply. It is never shown as
  approved content.
- If the usable buffer plus scheduled posts falls below the founder's
  `low_buffer_threshold` for the remaining slots, the dashboard flags a
  shortfall. It offers to generate a **limited** batch of concepts or drafts
  (§5.4). It never generates or publishes anything automatically.

---

## 5. Content generation

### 5.1 Inputs that must be traceable

Every generated concept and draft records:

- the brief version,
- the voice profile version,
- the writing examples retrieved,
- the research findings and approved insights supplied,
- the prompt template version, provider and model,
- the generation run (tokens, estimated cost, status, timestamps).

### 5.2 Stage A: concepts

Generated per founder in batches. Each concept has:

- Working title, target audience, core argument, proposed hook, format (e.g.
  observation, lesson, contrarian take, how-it-works explainer, story prompt,
  data point with commentary, question to the network).
- Related theme (primary or secondary).
- Supporting research findings (references, not pasted text).
- Relevant approved founder insights.
- Why it suits this founder.
- Overlap check: the most similar existing concepts, drafts and published posts,
  with a similarity explanation.
- Evidence and review requirements, e.g. "needs a 2026 figure for average
  repair cycle time" or "needs a story from the founder."

Generation considers existing drafts, approved and published posts, and the
other founders' concepts for the month, to avoid repeated topics, arguments,
hooks and formats.

The admin **selects**, **edits**, **rejects** or **regenerates** individual
concepts. Regenerating one concept does not touch the rest of the batch.

### 5.3 Stage B: drafts

Generated from one selected concept. The output is structured, not
free text:

- `post_body`: the LinkedIn post text only.
- `alternative_hooks`: 2–4 alternative opening lines.
- `claims`: every externally verifiable factual claim in the body, each
  classified as `sourced_fact`, `opinion`, `interpretation` or
  `founder_experience`, with the finding it relies on (or none).
- `source_refs`: findings used.
- `rationale` (internal): why this angle and structure.
- `review_flags`: unsupported or uncertain claims, missing personal context,
  competitor statements, product claims, possible repetition.
- References to the brief version and concept.

The rationale and flags are stored as metadata and **never** appended to the
post body. A deterministic check after generation rejects output whose body
contains source lists, "Rationale:" or flag text.

Several drafts may exist for one concept (e.g. two angles). Each draft has its
own version history. Regeneration creates a new version of the same draft,
or a new draft if the admin chooses. **Nothing is overwritten.**

### 5.4 Volume control

- Candidate targets (§2.3) are ceilings for a month, not quotas.
- The "replenish" action calculates need as described in DATA_MODEL §12.4. It
  proposes a batch no larger than the configured batch size (default 5 concepts
  or 3 drafts per founder per run). The admin confirms it before it runs.
- If the supply of usable, unused, relevant content is already sufficient, the
  system says so and does not offer generation.
- Per-run and per-month cost ceilings apply (SECURITY §10).

### 5.5 Founder voice

Each founder has an independent, versioned **voice profile** that the admin
can read and edit:

- Vocabulary and phrasing preferences; phrases to avoid.
- Sentence length and paragraph structure.
- Use of humor, anecdotes and technical explanation.
- Preferred technical depth.
- Point of view and communication style.
- Topics of genuine experience, the only topics the generator may write about
  in first person.
- Writing habits.
- Linked writing examples: published LinkedIn posts and explicitly approved
  examples (and later, approved Slack excerpts).

No custom model is trained. The generator uses the structured profile plus
examples retrieved by relevance (same format, same topic, most recent).

**Edits are classified, not absorbed.** When a founder or admin edits a draft,
the system can *propose* a feedback signal, classified as one of:

1. **Stable preference.** "Never open with a question." A candidate for the
   voice profile.
2. **Format preference.** "For data posts, put the number first." Stored
   against the format.
3. **One-off edit.** Specific to this post. Not generalized.
4. **Editorial or strategic correction** by the admin. "Don't name
   competitors." It goes to the brief or global guidelines, not the founder's
   voice.

Classification is a proposal. Only the admin accepts a signal into a new voice
profile version, and each change records why. Edits are never assumed to be
permanent rules. Performance metrics never change a voice profile
automatically (§9).

### 5.6 Authenticity rules (hard requirements)

- The generator **must not invent** first-person experiences, anecdotes,
  opinions, quotes, customer stories or statements attributed to a founder.
- A draft that needs a personal story not established in approved source
  material uses an explicit placeholder, for example
  `[FOUNDER TO SUPPLY: a time a repair status surprise cost you a day]`, and
  carries a `needs_personal_context` flag. A draft with an unresolved
  placeholder cannot be approved (enforced in the database; SECURITY §11).
- No invented URLs, statistics, quotations, studies or source details.
- Every externally verifiable factual claim either links to a stored finding or
  is flagged.
- Sourced facts, opinion, interpretation and founder experience are
  distinguished in the claims metadata.
- Competitor claims need a source and are flagged for review regardless.

### 5.7 Quality bar

Drafts are checked (by prompt instruction and by a post-generation lint) for:

- generic AI thought-leadership patterns and stock phrases (a maintained
  list per founder and globally),
- excessive sales language and calls to action (CTA frequency follows the
  brief),
- formulaic or repeated hooks,
- artificially short, choppy single-sentence paragraphs,
- unsupported claims and unsupported competitor claims,
- recycled arguments (§6).

Posts do not have to mention Autograff or its products.

Company-wide style rules from Autograff's marketing source of truth apply to
founder posts too, unless a founder's voice profile overrides them. Examples
are no em-dashes and no unsourced numbers. Which rules carry over is decision
D-15.

---

## 6. Diversity and repetition

Each concept and draft carries a **content fingerprint**, extracted by the
model and editable by the admin:

- topics (from a controlled, extensible list),
- core argument (one normalized sentence),
- hook type and opening line,
- format,
- audience,
- evidence sources,
- product mentions,
- call to action,
- founder.

The diversity report for a month shows the distribution of each field per
founder and across founders.

Near-duplicate and repeated-argument detection compares a candidate against
published posts (look-back window configurable, default 180 days), approved and
scheduled posts, live drafts, and other founders' content for the month:

1. **Cheap pre-filter.** Fingerprint overlap (same topic and format, or same
   argument key) plus trigram text similarity in Postgres.
2. **Semantic check** on the shortlist. A model compares core arguments and
   explains overlap. Optionally embedding similarity later (D-07).

Results are warnings with an explanation, not silent blocks. The admin can
**override** a repetition warning with a recorded reason, for example "a
deliberate follow-up to the March post." Overrides are audited.

The CTO's lower cadence is treated as **selectivity**: higher originality
threshold, more candidates per slot (4–6 for 2 slots), and a stronger research
requirement. It does not mean less effort per post.

---

## 7. Review and approval

### 7.1 Draft states

```
concept ─select→ (draft) drafting → admin_review → founder_review → approved → scheduled → published
                                 ↘ changes_requested ↗        │            │
                                     (return for revision) ←──┘            │
              any pre-published state → rejected | archived    (approved/scheduled: unschedule → approved)
```

| State | Meaning | Who moves it |
|---|---|---|
| `drafting` | Being generated or edited by the admin before review | System, admin |
| `admin_review` | Ready for the admin to curate | System, admin |
| `founder_review` | Shared with the founder | Admin |
| `changes_requested` | Founder asked for changes or a rewrite; or the admin returned it | Founder, admin |
| `approved` | Current version has a valid founder approval | Founder approval (system sets) |
| `scheduled` | Approved and assigned a scheduled date | Admin |
| `published` | Publication recorded | Admin (or the LinkedIn integration later) |
| `rejected` | Not to be used. Kept for learning | Admin, founder |
| `archived` | Shelved. Can be restored to `admin_review` | Admin |

Transitions are enforced by a single server-side state machine and a database
trigger. Illegal transitions fail. For example, `drafting` cannot go straight
to `published`, and only `approved` or `scheduled` can go to `published`.

### 7.2 Editing and versions

- The admin can edit a draft before sharing it. Every save creates a new
  immutable **draft version** with author, timestamp and source (`ai`,
  `admin`, `founder`).
- Founders can edit, comment (anchored to text where possible) and request a
  rewrite with instructions. A rewrite request creates a generation run whose
  output is a new version, not an overwrite.
- Full version history and diffs between any two versions are viewable.

### 7.3 Approval

- An approval is a record of **who approved which exact version, when**, and
  the content hash of that version.
- In the MVP, the approval that counts is the **founder's** approval of their
  own post. The admin "shares" a version rather than approving it. Founder
  approval is required and sufficient (D-11, agreed 2026-10-21).
- Review flags do not approve anything. A draft with zero flags is still
  unapproved until a person approves it.
- Approval is blocked while any `blocking` flag is open: an unresolved
  `[FOUNDER TO SUPPLY]` placeholder, a claim marked `unsupported` that has not
  been resolved or removed, or a competitor claim without a source.

### 7.4 Material edits and approval invalidation

**Rule (recommended, D-05):** an edit is **material** if it changes the
normalized post body. Normalization only does the following:

- converts line endings to `\n`,
- trims trailing whitespace on each line,
- trims leading and trailing blank lines,
- applies Unicode NFC.

Every other change counts as material: a word, punctuation, emoji, a link, a
hashtag, line breaks between paragraphs, or the selected hook. If it shows up
differently on LinkedIn, the founder must see it again.

Not material:

- the scheduled or proposed date,
- internal notes, rationale, tags or the fingerprint,
- comments,
- resolving a flag without changing the text.

When a material edit is saved to an approved or scheduled draft, the following
all happen in one transaction:

1. The new version is created.
2. The existing approval is marked `invalidated` with the reason and the new
   version id.
3. The draft returns to `founder_review` (or `admin_review` if the admin made
   the edit).
4. If it was scheduled, it is unscheduled, the slot is freed and the date is
   kept as a proposed date.
5. An audit event is written.

This is checked by comparing the content hash of the approved version with the
draft's current version. Publishing requires them to match (§8.1), so even a
bug in the edit path cannot publish unapproved text.

The strict rule is deliberate: it is simple, consistent and easy to test. A
lighter "minor change, quick re-confirm" flow can be added later without
changing the rule (D-05).

---

## 8. Publishing

### 8.1 Gate (applies to every publishing path)

A post may be published, or recorded as published, only if all of these hold:

- the draft is `approved` or `scheduled`,
- a non-invalidated approval exists for the draft's current version,
- the approval's content hash equals the current version's hash,
- no blocking flag is open.

This is enforced in a database function used by every publish path, not only in
the UI.

### 8.2 MVP: assisted publishing

- Publishing calendar (§4.3).
- **Copy to clipboard** of the approved text (exactly the approved version).
- Admin records: actual publication date and time, LinkedIn post URL, and the
  **text as actually published** (pasted back, or confirmed as identical).
- The system stores the published text and shows a **diff against the approved
  version**. Differences are allowed, since LinkedIn may change formatting or
  the founder may tweak at the last minute. They are highlighted and audited,
  and they feed back as one-off edits.
- Clear publication status on the calendar and dashboard.

If the admin records a publication for a post that was never approved in the
studio (for example, a founder posted something on their own), the system
records it as an `external` publication. It is used for repetition checks and
reporting, but it never counts as an approved studio draft.

### 8.3 Later: LinkedIn integration (Phase 10)

Only after API access is verified (INTEGRATIONS §5). Publishing sits behind a
`PublishingProvider` interface. Only content passing §8.1 can be queued. Each
attempt is idempotent per draft (one publication per draft). Its status is
tracked, and the manual path remains available as a fallback. Nothing is
promised until access is confirmed.

---

## 9. Performance feedback (later phase)

Where permissions allow, metrics are collected per publication and compared by
theme, topic, format, hook, founder and publication timing. Metrics can be
pulled from an API or entered by hand. Engagement is one input to planning. It
is not proof of authenticity or strategic correctness, and it **never
rewrites a voice profile automatically**. Not all metrics will be available for
every account (INTEGRATIONS §5.4).

---

## 10. Research and insights (summary)

Detailed in [INTEGRATIONS.md](INTEGRATIONS.md) §3–4.

- Research is collected per brief and per concept, prioritizing primary sources
  and reputable publications. URL, title, publisher, publication date, event
  date (if different), retrieval date, excerpt, extracted claims and
  verification status are stored for each source.
- Retrieved content is **untrusted input** (SECURITY §6).
- Slack-derived insights are candidates. They need admin approval before any
  generation can use them. Slack is not required for the MVP. Manually added
  writing examples, notes and research work without it.

---

## 11. Non-goals for the MVP

- Commercial multi-tenancy, billing, or self-service signup.
- Training or fine-tuning a model.
- Automated LinkedIn publishing or metrics (until verified).
- Reading Slack DMs or ingesting whole workspaces.
- Publishing to other networks.
- Image or video generation. Text posts only. Attachments can be noted as
  "to add manually."

---

## 12. Acceptance criteria (product level)

The MVP is accepted when, with no Slack or LinkedIn access:

1. The admin can invite three founders. Each can sign in and sees only their own
   shared drafts and calendar. A founder's direct API or database request
   for another founder's draft returns nothing.
2. The admin can create a brief, save v1 and v2, and see which version each
   concept and draft used. Creating v2 changes no existing draft.
3. Cadence rules for CTO (2/month), CEO and COO (2–3/week) produce the expected
   slots for any month, including boundary months. Changing a rule changes only
   future open slots.
4. The coverage dashboard shows every measure in §4.4. A test fixture
   confirms that no draft is counted twice and that rejected, archived, pending
   and published items are excluded from supply.
5. The admin can add writing examples by hand, edit a voice profile and see
   its version history.
6. The admin can generate a concept batch, select concepts, generate a draft,
   regenerate one concept or draft without affecting others, and see every
   version.
7. Each draft shows claims, sources and flags separately from the post body.
   Unsupported claims and missing personal context are flagged, and drafts with
   blocking flags cannot be approved.
8. A founder can edit, comment, request a rewrite, approve and reject. A
   material edit after approval invalidates it. Scheduling and rescheduling do
   not.
9. The admin can schedule approved posts, copy the exact approved text, record
   the publication URL, date and actual text, and see the diff.
10. No code path publishes or records as published a draft without a valid
    approval for its current version. This is covered by database-level tests.
11. Repetition warnings appear for a seeded near-duplicate. The admin can
    override with a reason, and the override is audited.
12. Generation stops at the configured cost ceiling.
