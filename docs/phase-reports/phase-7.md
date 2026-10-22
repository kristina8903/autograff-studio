# Phase 7 report: review and approval portal

Date: 2026-10-22. Scope:
[PHASES.md, Phase 7](../PHASES.md#phase-7-review-and-approval-portal).
Built and tested locally against the **fake** AI provider; no real AI call was
made. The definition of done, the founders trying the review flow on staging,
comes after this is merged and migrated.

## What was built

| Area | Where |
|---|---|
| Database: `approvals` (insert-only; one live approval per draft), `comments` (shared or admin-internal, anchored by quote), `rewrite_requests`; the material-edit trigger; the admin and founder state machine; founder read functions that never return the rationale, internal comments or unshared flags | `supabase/migrations/20261022000002_review_approval.sql` |
| State machine by role, approval blockers, the material-edit rule in TypeScript | `lib/domain/draft-states.ts`, `lib/domain/drafts.ts` (`isMaterialEdit`) |
| Admin draft page: share with the founder (choosing which flags they see), take back for revision, withdraw an approval, comments (internal or shared), the approval record (who, which version, hash, when, and why it was withdrawn), the founder's rewrite requests; edits now allowed on shared and approved drafts | `app/admin/drafts/[id]/page.tsx`, `app/admin/drafts/draft-forms.tsx`, `app/admin/draft-actions.ts` |
| Founder **Drafts** list and review page: the post and its chosen opening line, things to check, word-level changes from the previous version, version history, comments, edit, rewrite request, approve (the exact version shown), request changes, reject, withdraw approval. A "drafts to review" card on the dashboard | `app/drafts/`, `app/dashboard/page.tsx`, `components/founder-nav.ts` |
| Rewrites: runner handles `rewrite` runs like regenerations and records the inputs it chose; a founder's run starts right after the request (checked to be their own), otherwise the cron tick runs it | `lib/server/generation/runner.ts`, `lib/server/admin/generation.ts` |
| Feedback proposals from founder edits: versioned prompt, fake handler, runner and store | `lib/prompts/feedback.v1.ts`, `lib/providers/llm/fake.ts` |
| Shared word-diff component | `components/word-diff.tsx` |

## Test results (final run, 2026-10-22)

| Command | Result |
|---|---|
| `npm run check` | pass; **159/159** unit tests (148 before, 11 new) |
| `npm run test:db` | pgTAP **443/443** (321 before, 122 new in `06_review_approval.test.sql`); parity **12/12** |
| `PLAYWRIGHT_CHROMIUM_EXECUTABLE=/opt/pw-browsers/chromium npm run test:e2e` | **54/54** (43 before, 11 new in `e2e/review.spec.ts`), zero CSP violations |
| `npm run build` | pass |
| `npm audit --omit=dev` | 0 vulnerabilities |

Failures during the build, all fixed before the final run:

1. **Product bug, caught by e2e:** an admin edit recomputes claim flags from
   the text, so a claim the admin had already resolved came back as an open
   blocking flag after any edit, even a typo fix. The founder could not
   approve again until the admin re-resolved it. Now a flag raised again for
   the same reason keeps its decision (and its shared state). A pgTAP test
   covers it.
2. **Rule gap, found on review:** the spec counts a change of the selected
   opening line as material, but the first version of the migration bound
   approvals to the body hash only. Approvals now also record the selected
   line; changing it withdraws the approval (pgTAP and unit tests).
3. **Leak path, found on review:** repetition flags quote other drafts,
   which may be another founder's, and the admin could have shared one.
   Repetition flags are now never shown to a founder, whatever the admin
   picks. A pgTAP test checks it.
4. **Design fix, found on review:** every re-approval would have queued
   another feedback proposal for the same edits. Now only edits not yet
   classified queue one (pgTAP: two rounds of edits, two proposals).
5. **My test expectations, wrong eight times, with no code change:**
   - two idempotency keys shorter than the 16-character minimum;
   - two orderings: enum versus text order, and equal timestamps inside one
     transaction;
   - a "visible" check on a whitespace-only diff piece;
   - three success messages from forms that correctly disappear once the
     draft changes state (share, approve, request changes);
   - an ambiguous "Comment" label.

## Acceptance criteria

| # | Criterion | Evidence |
|---|---|---|
| 1 | A founder sees only drafts shared with them; admin-internal comments and rationale are never returned to a founder (API-level test) | e2e: unshared draft is a 404 and absent from the list; no rationale or internal comment on the page; through the REST API, the owner's versions carry no `rationale` key, `draft_versions` and `comments` return nothing, and another founder gets an empty result and a refused comment. pgTAP: founder A vs B on every function, anon denied, direct table reads empty |
| 2 | Approval records approver, version, hash and time | pgTAP: approver, role, version, hash equal to the version's, time, note; e2e: the admin's approval panel shows them |
| 3 | Material-edit rule: a change to the normalized body after approval invalidates it in the same transaction and returns the draft to review; whitespace-only and metadata changes do not | pgTAP: whitespace-only admin edit keeps the approval; one word withdraws it (reason, new version id, audit event) and returns it to admin review; an unselected alternative opening line keeps it; choosing a different one withdraws it; a founder edit returns to founder review; a rewrite landing on an approved draft withdraws it. Unit: `isMaterialEdit` table. e2e: admin edit after approval |
| 4 | Approval is impossible with an open blocking flag or a placeholder | pgTAP: refused with a placeholder, with an open blocking claim, and with a placeholder whose flag was force-resolved; e2e: the Approve button is disabled with the reason |
| 5 | A draft with zero flags is still not approved until a person approves it | pgTAP: no status write, no admin path to `approved` (state machine and `approve_draft` both refuse the admin); unit: no role but the founder can reach `approved` |
| 6 | A rewrite request produces a new version and keeps all old versions | pgTAP: version 8 by the AI, all 7 earlier kept, request completed and linked; e2e: version 5 appears and version 2 is still readable |

### Named tests from PHASES.md

| Test | Where |
|---|---|
| Normalization table (CRLF, trailing spaces, NFC vs NFD, emoji, hashtag change, paragraph-break change) | `lib/domain/draft-states.test.ts` (`isMaterialEdit`); SQL parity in `tests/db/normalize-parity.test.ts` |
| Invalidation trigger, including concurrent edit and approve | pgTAP: a stale version id is refused; e2e: the admin edits while the founder has the page open, and the founder's approval is refused with "The draft changed since you opened it" |
| State machine matrix (role × from × to) | `lib/domain/draft-states.test.ts`, every pair for both roles; the SQL functions are tested move by move in pgTAP |
| RLS cross-founder | pgTAP and the e2e API test |
| E2E: admin shares → founder edits → approves → admin edits → approval invalidated | `e2e/review.spec.ts` |

## Decisions

- **D-32: founder review and approval** (in `DECISIONS.md`):
  - founder reads only through functions;
  - approvals bind to the body hash and the selected opening line, not to
    the version id;
  - approving a version that is no longer current is refused;
  - who moves which state;
  - how flags carry over on founder and admin edits;
  - rewrite costs and limits;
  - feedback proposals;
  - quote-anchored comments;
  - repetition flags are never shared.
- **DATA_MODEL.md**, "Implemented in Phase 7", lists the differences from
  the proposal.

## Not done, and why

- **Email notifications (optional in scope, D-20).** D-20 is still open.
  Founders see waiting drafts on their dashboard and the Drafts page. Say if
  you want the "shared with you" and "approved" emails; they would use the
  existing SMTP provider at no extra cost.
- **Definition of done: the founders try the review flow on staging.** This
  needs the migration applied to staging (the migrate workflow runs on
  merge). It works with the fake AI, so it does not wait for the Anthropic
  key.
- **No real AI call has been made by any test.** Rewrites and feedback
  proposals use the fake provider; the Anthropic path is first exercised on
  staging.
- **Lint is not re-run on a founder's own edits** (D-32). Placeholders are,
  and the admin sees every founder version and its changes.
- **Scheduling and publication** are Phases 8 and 9. The publish gate there
  must use `private.valid_approval`, which already checks the hash and the
  selected line.
