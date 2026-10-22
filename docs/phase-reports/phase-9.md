# Phase 9 report: assisted publishing and reporting

Date: 2026-10-22. Scope:
[PHASES.md, Phase 9](../PHASES.md#phase-9-assisted-publishing-and-reporting).
Built and tested locally against the fake AI. The phase uses no external
service: publishing stays manual (no LinkedIn API, Phase 10).

## What was built

| Area | Where |
|---|---|
| Database: one publish gate used by every path; schedule, reschedule and unschedule (with slots); the approved text for copying; `publications` (one per draft, insert-only, text compared after normalization); external publications; `performance_snapshots`; published posts as writing examples (setting); scheduled drafts can be edited, rewritten, revoked or withdrawn, which unschedules them | `supabase/migrations/20261024000001_publishing.sql` |
| The text to post (the chosen opening line in place of the first line) in TypeScript, matching SQL; scheduled and published states for each role; time-zone conversion for scheduling (daylight-saving safe); report aggregation | `lib/domain/drafts.ts`, `lib/domain/draft-states.ts`, `lib/domain/dates.ts`, `lib/domain/reports.ts` |
| **Publishing** panel on the draft page: the text to post, "Copy approved text" (from the server), schedule or reschedule (date, time, slot), unschedule, record the publication ("Posted exactly as approved" or paste the posted text), then the record with its diff and metrics | `app/admin/drafts/[id]/page.tsx`, `app/admin/publishing-forms.tsx`, `app/admin/publishing-actions.ts` |
| **Publications** page: scheduled posts, the month's publications with their latest metrics and a metrics form, external posts, and the writing-examples setting | `app/admin/publications/page.tsx` |
| **Reports** page: published per founder and month against the cadence range, then counts and average metrics by theme, format and founder | `app/admin/reports/page.tsx` |
| Calendar slots show their scheduled or published draft. Founders see when each post goes out, or its LinkedIn link | `app/admin/calendar/page.tsx`, `app/drafts/` |

## Test results (final run, 2026-10-22)

| Command | Result |
|---|---|
| `npm run check` | pass; **212/212** unit tests (201 before, 11 new) |
| `npm run test:db` | pgTAP **557/557** (488 before, 69 new in `08_publishing.test.sql`); parity **12/12** |
| `PLAYWRIGHT_CHROMIUM_EXECUTABLE=/opt/pw-browsers/chromium npm run test:e2e` | **67/67** (61 before, 6 new in `e2e/publishing.spec.ts`), zero CSP violations |
| `npm run build` | pass |
| `npm audit --omit=dev` | 0 vulnerabilities |

Failures during the build, all fixed before the final run:

1. **Product bug, caught by e2e: a refused save erased the form.**

   ```
   Expected substring: "Impressions 1,200 · Reactions 45"
   Received: "…As of Oct 22, 2026: Reactions 45…"
   ```

   React resets a form after its action runs, even when the save was
   refused. A metrics entry that failed validation lost the numbers already
   typed, so the corrected save went in without them. A refused publication
   record would likewise have lost the pasted post text. The publishing forms
   now keep their values until a save succeeds.
2. **Product bug, caught by e2e: the outside-post form defaulted to a future
   time.** It pre-filled "now" in UTC, but the time is read in the chosen
   founder's time zone (Los Angeles here), so the default was hours ahead and
   refused. The default now follows the selected founder's clock.
3. **Bug in my own code, caught by unit tests:** scheduling at a time that
   daylight saving skips (02:30 on March 8 in Los Angeles) gave the hour
   before the jump. It now gives the time just after it.
4. **Two Phase 2 tests filled slots with made-up draft ids**, because drafts
   didn't exist then: `02_strategy_cadence.test.sql` and
   `tests/db/coverage-parity.test.ts`. The new foreign key from slot to draft
   refuses that, correctly.

   ```
   ERROR:  insert or update on table "calendar_slots" violates foreign key constraint "calendar_slots_draft_fk"
   ```

   Both now create a real draft row. The foreign key stays.
5. **My test mistakes, with no product change:**
   - an approve helper read the version id under the founder's role, which
     can't read the drafts table;
   - the e2e setup read a page address before navigation finished;
   - the setup needed more than the default hook time;
   - two locators were ambiguous;
   - the clipboard comparison expected LF line endings where the stored text
     has CRLF. Browsers submit textareas that way. The test now checks
     byte-for-byte against the server's approved text, and against the
     founder's view after normalization, which is what the criterion says.

## Acceptance criteria

| # | Criterion | Evidence |
|---|---|---|
| 1 | An unapproved draft, or one whose approval is invalidated, cannot be scheduled or recorded as published, through the UI and through a direct RPC call with an admin JWT | pgTAP: every precondition on every path. Covered: admin review, founder review, an open blocking flag, an approval by anyone but the founder (with the status forced to approved), an edit that withdrew the approval, a direct status write, a direct insert. Also: founder and admin without MFA refused. e2e: no publishing panel on an unapproved draft, and `schedule_draft`, `approved_text` and `record_publication` refused over the REST API with the admin's token |
| 2 | Rescheduling keeps the approval; editing the text does not | pgTAP: rescheduling and unscheduling keep the same approval; an admin edit of a scheduled draft withdraws it, unschedules, frees the slot and blocks rescheduling. The founder withdrawing approval also unschedules. e2e: rescheduled to another slot, approval still "valid" |
| 3 | Copied text equals the approved version byte for byte (after normalization) | pgTAP: `approved_text` equals the approved body; a chosen opening line replaces the first line. e2e: the clipboard holds exactly the server's approved text, and equals the founder's approved version after normalization |
| 4 | A publication record stores URL, date and actual text; a differing text shows a diff and an audit event | pgTAP: URL, date, text, hash, the approval and version it rests on; a differing text is stored next to the approved one, audited and proposed as a one-off edit; whitespace-only differences don't count. e2e: diff shown on the draft page |
| 5 | A second publication for the same draft is rejected | pgTAP; e2e over the API |

### Named tests from PHASES.md

| Test | Where |
|---|---|
| Publish-gate database tests (every invalid precondition) | `supabase/tests/database/08_publishing.test.sql` |
| E2E schedule → copy → record | `e2e/publishing.spec.ts` |
| Clipboard content test | `e2e/publishing.spec.ts`, criterion 3 |
| Report queries on fixtures | `lib/domain/reports.test.ts`: founder's own calendar month across time zones, every post in exactly one group, averages only over posts that recorded the metric |

## MVP acceptance (PRODUCT_SPEC §12): the definition of done

The definition of done is that all twelve criteria pass **on staging**. This
table says where each is proven locally. The staging check happens after
merge, with real accounts.

| # | Criterion | Local evidence | On staging |
|---|---|---|---|
| 1 | Three founders invited, each sees only their own drafts and calendar; direct API access to another's draft returns nothing | Phases 1 and 7, pgTAP and e2e | Invite the three founders (needs Vercel protection on previews only) |
| 2 | Brief v1 and v2; each concept and draft shows its version; v2 changes no draft | Phases 2 and 4 | Check |
| 3 | Cadence slots for CTO, CEO and COO, boundary months; rule changes touch only future open slots | Phase 2 | Check |
| 4 | Coverage dashboard with every measure in §4.4; no double counting | Slot counts only (Phase 2); **the full dashboard is Phase 8** | Waits for Phase 8 |
| 5 | Writing examples, voice profile edits and history | Phase 3 | Check |
| 6 | Concepts, drafts, regenerating one without touching others, every version | Phase 4 | Needs the AI key for real output; works with the fake |
| 7 | Claims, sources and flags apart from the body; unsupported claims and missing context flagged; blocking flags stop approval | Phases 4, 5 and 7 | Check |
| 8 | Founder edits, comments, rewrites, approves and rejects; a material edit invalidates; scheduling and rescheduling don't | Phases 7 and 9 | Founders try it |
| 9 | Schedule, copy the exact text, record URL, date and text, see the diff | Phase 9 | Check |
| 10 | No path publishes without a valid approval of the current version (database tests) | Phase 9 pgTAP | — |
| 11 | Repetition warning for a near-duplicate; override with a reason, audited | Phase 4 | Check |
| 12 | Generation stops at the cost ceiling | Phase 4 | Check |

Criterion 4 cannot pass until Phase 8 (pipeline management) is built: the
coverage dashboard is Phase 8's scope. That phase is next in the agreed
order.

## Decisions

- **D-34: publishing** (in `DECISIONS.md`):
  - the single gate;
  - the text to post, and what "byte for byte" means with CRLF;
  - scheduling, and what unschedules;
  - recording, differences and one-off feedback;
  - external posts;
  - publications as writing examples (not approved for voice by default);
  - metrics and reports.
- **DATA_MODEL.md**, "Implemented in Phase 9", lists the differences from
  the proposal.

## Not done, and why

- **The LinkedIn API** (publishing and metrics) is Phase 10, after access
  and terms are verified. Everything here is manual.
- **Coverage measures beyond slot counts** (scheduled, approved buffer,
  supply gap) are Phase 8. The calendar's "Content ready" column says so.
- **A recorded publication can't be corrected:** records are insert-only for
  audit. A wrong link or time needs a database correction by the owner.
  Say if an audited "correct record" action is wanted.
- **Email notifications** (D-20) remain open.
