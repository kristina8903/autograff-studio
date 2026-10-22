# Phase 4 report: content concepts and generation

Dates: 4a on 2026-10-21, 4b on 2026-10-22. Scope:
[PHASES.md, Phase 4](../PHASES.md#phase-4-content-concepts-and-generation).
The first half (AI provider, runs, cost ceilings, concepts) is reported in
detail in [phase-4a.md](phase-4a.md). This report covers 4b (drafts) and the
phase as a whole.

Built and tested locally against the **fake** AI provider; no real AI call
was made. The definition of done, a manual review of about 10 real drafts per
founder on staging, needs the staging API key (runbook step 8).

## What 4b built

| Area | Where |
|---|---|
| Database: `drafts`, immutable `draft_versions` (normalized content hash and placeholder count set by trigger), `draft_claims`, `review_flags`, `repetition_checks`; RLS admin-only; writes only through functions; the draft state machine for Phase 4 | `supabase/migrations/20261022000001_drafts.sql` |
| Body normalization and content hash, matching the SQL version (parity-tested) | `lib/domain/drafts.ts` |
| Review rules: placeholders, claim support, model flags, lint (metadata in the body, links, length, stock and avoided phrases, em-dashes, choppy paragraphs) | `lib/domain/draft-review.ts` |
| Word-level diff between any two versions | `lib/domain/diff.ts` |
| Versioned draft prompt and repetition-judge prompt | `lib/prompts/draft.v1.ts`, `lib/prompts/repetition-judge.v1.ts` |
| Runner: draft generation, metadata rejection, flags, repetition pre-filter and judge (with fallback), all stored in one transaction | `lib/server/generation/runner.ts`, `lib/server/admin/generation.ts` |
| Repetition pre-filter in Postgres (`pg_trgm` plus argument key) against live drafts, the month's concepts and published LinkedIn posts | `repetition_candidates` in the migration |
| Concepts page: "Write a draft" / "Write another draft" for selected concepts, with links to each draft | `app/admin/concepts/` |
| **Drafts** list (per founder and month, open blocking and warning counts) and draft page (post text, opening lines, flags with resolve/override, claims, internal rationale, edit as a new version, regenerate with guidance, version history and compare, state changes) | `app/admin/drafts/` |
| Opt-in evaluations with a hard $1 cap: `npm run eval:generation`, `npm run eval:voice` | `tests/eval/`, `vitest.eval.config.mts` |

## Test results (final run, 2026-10-22)

| Command | Result |
|---|---|
| `npm run check` | pass; **148/148** unit tests (126 after 4a, 22 new) |
| `npm run test:db` | pgTAP **321/321** (263 after 4a, 58 new); parity **12/12** (coverage 1, plus 11 new normalization cases) |
| `PLAYWRIGHT_CHROMIUM_EXECUTABLE=/opt/pw-browsers/chromium npm run test:e2e` | **43/43** (36 after 4a, 7 new), zero CSP violations |
| `npm run build` | pass |
| `npm audit --omit=dev` | 0 vulnerabilities |
| `npm run eval:generation`, `npm run eval:voice` | skipped, as intended: no key and no `EVAL_CONFIRM=1`. Not run against the real API |

Failures during the 4b build, all fixed before the final run:

1. **Product bug, caught by e2e:** the Concepts page did not refresh while
   a draft was being written, because it only watched concept runs. It now
   watches draft runs too.
2. **Rule gap, found on review:** the database would have accepted
   overriding a *blocking* flag, although the page offered no button for
   it. The database now refuses it; a pgTAP test proves it.
3. **My test expectations, wrong six times, with no code change:**
   - two hand-counted character offsets;
   - expecting a drafted concept in the repetition pre-filter (it is
     correctly excluded: its draft is compared instead);
   - expecting an empty result instead of the "admin only" error for
     another company;
   - capturing a page address before navigation finished;
   - an ambiguous "Post text" label;
   - expecting a word-level diff to mark a sentence as one piece.

## Phase 4 acceptance criteria

| # | Criterion | Evidence |
|---|---|---|
| 1 | A concept batch records brief version, voice version, examples, model and cost | 4a: e2e and pgTAP |
| 2 | Regenerating one concept or draft leaves others untouched; previous versions remain | Concepts: 4a. Drafts: e2e "regenerating creates a new version and earlier versions stay readable"; pgTAP: regeneration is version 2 linked to version 1, no new draft, version 1 unchanged, versions immutable even for the owner |
| 3 | The post body never contains rationale, flags or source lists | Unit: `metadataLeak` cases; runner test "rejects a body that carries a rationale or sources, and stores nothing"; e2e: the rationale is shown separately, never in the post |
| 4 | A draft needing a personal story has a `[FOUNDER TO SUPPLY: …]` placeholder and a blocking flag | Unit: placeholder flags; runner test; e2e: blocking, no resolve button, clears only when the text replaces it; pgTAP: a placeholder can't be resolved |
| 5 | Every factual claim not backed by an approved fact or finding is flagged | Unit `reviewClaims`: unbacked and invalid-index facts are blocking, backed facts supported, opinions not applicable; e2e: flag and "unsupported" claim shown |
| 6 | Seeded near-duplicates trigger a repetition warning; an override needs a reason and is audited | e2e: a second draft of the same argument gets the warning, a short reason is refused, a real one is recorded; pgTAP: pre-filter finds the same-argument concept and a similar published post, override needs ≥5 characters, decisions audited |
| 7 | Over-ceiling runs refused before the API call; spend shown with an 80% warning | 4a: e2e and pgTAP |
| 8 | Double-submitting creates one run | 4a: e2e and pgTAP |

### Named tests from PHASES.md

| Test | Where |
|---|---|
| Structured-output validation and rejection paths | `tests/unit/runner.test.ts`: concepts and drafts, wrong shape, limits, metadata in the body |
| Idempotency | 4a |
| Retry on 429/5xx, none on 400 | 4a; the judge's failure falls back without failing the draft |
| Budget refusal | 4a; the draft estimate includes the judge |
| Lint rules | `lib/domain/draft-review.test.ts` |
| State machine transitions, allowed and forbidden | pgTAP: to published, to approved, out of rejected, editing archived drafts, direct status writes |
| Repetition pre-filter on fixtures | pgTAP `05_drafts.test.sql` |
| Opt-in `npm run eval:generation` with a hard cap | `tests/eval/`; the cap is unit-tested to refuse before calling |

## Decisions

- **D-28** and **D-29** (4a): how runs execute and spend; concepts.
- **D-30: drafts and flags.**
  - Flags are computed in TypeScript and stored per version.
  - Metadata in the body is rejected, not flagged.
  - Blocking flags are resolved with a reason, never overridden; overrides
    are recorded on the flag.
  - Admin edits recompute placeholder, claim and lint flags, and carry over
    the model's and repetition flags.
  - Repetition thresholds and the judge's fallback are fixed.
  - "Whitespace" in normalization means spaces and tabs.
  - Founder access and approval wait for Phase 7.
- **D-31: evaluations.**
  - They are opt-in, with a hard $1 cap.
  - They use a fixture by default, or real held-out examples from a local
    JSON file, so real founder text never goes into the repository.

## Not done, and why

- **Definition of done: the manual quality review of about 10 real drafts
  per founder on staging.** This needs the staging API key (runbook step 8),
  then a few concept batches and drafts per founder. The result is recorded
  here afterwards, and D-06b (which model writes drafts) is decided from it.
- **No real AI call has been made by any test.** That is deliberate. The
  Anthropic implementation is first exercised on staging, or by the opt-in
  evaluations.
- **Founders do not see drafts yet**, and approval, sharing and the
  approval-invalidating edit path do not exist. All are Phase 7, next in
  the agreed order.
- **`concept_evidence` and finding-backed claims** wait for research (Phase 5).
