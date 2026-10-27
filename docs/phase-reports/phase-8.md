# Phase 8 report: pipeline management

Date: 2026-10-27. Scope:
[PHASES.md, Phase 8](../PHASES.md#phase-8-pipeline-management).
Built and tested locally against the fake AI. The phase adds no external
service and no paid call: the replenish action asks the existing concept
generator, under the same cost ceilings.

## What was built

| Area | Where |
|---|---|
| Database: one bucket per draft (`coverage_draft_buckets`); coverage for a founder and period (`coverage`): slots, publications, every bucket, concepts waiting, the next open slot; replenishment inputs for a month (`candidate_supply`); `settings.batch_size_concepts` (default 5). All read-only and admin-only | `supabase/migrations/20261025000001_pipeline.sql` |
| The same bucket rule in TypeScript, the coverage status, the shortfall flag and the replenishment batch; the diversity distributions and hot spots | `lib/domain/coverage.ts`, `lib/domain/diversity.ts` |
| **Pipeline** page: a summary per founder (status, buffer flag, required, published, scheduled, in hand, gap, next open slot), then a card per founder with every §4.4 measure, the pipeline, what is never counted, and replenishment with a confirm step. Period of 1–3 months | `app/admin/pipeline/page.tsx`, `pipeline-forms.tsx`, `lib/server/pipeline.ts`, `replenishAction` in `app/admin/concept-actions.ts` |
| **Diversity** view: topics, formats, hooks, audiences, product mentions and calls to action for a month, per founder and overall; repetition hot spots | `app/admin/pipeline/diversity/page.tsx` |
| **Combined calendar**: filter by state as well as founder; posts scheduled or published outside a slot (and external posts) on the grid; each founder's coverage status, linked to the Pipeline | `app/admin/calendar/page.tsx` |

## Test results (final run, 2026-10-27)

| Command | Result |
|---|---|
| `npm run check` | pass; **229/229** unit tests (212 before, 17 new in `coverage.test.ts` and `diversity.test.ts`) |
| `npm run test:db` | pgTAP **590/590** (557 before, 33 new in `09_pipeline.test.sql`); parity **13/13** (one new: the bucket parity) |
| `PLAYWRIGHT_CHROMIUM_EXECUTABLE=/opt/pw-browsers/chromium npm run test:e2e` | **75/75** (67 before, 8 new in `e2e/pipeline.spec.ts`), zero CSP violations; includes `npm run build` |
| `npm audit --omit=dev` | 0 vulnerabilities |

Failures during the build, all fixed before the final run:

1. **Bugs in my own code, found by re-reading the diff:**
   - Viewing a later month alone (December) while the next open slot was
     in November made replenishment target November, outside the period
     shown, and the action would then refuse December. The target month is
     now always inside the period. e2e test added.
   - A month already past could be offered for replenishment. It no longer
     is, on the page or in the action.
   - The calendar's state filter accepted `?show=toString` (a check through
     the object's prototype). It now accepts only its own keys.
2. **A misleading display, seen on the screenshots:** a month with no slots
   planned showed "At risk" with 0 slots required, hiding the cause. The
   Pipeline now says the month isn't planned and links to the calendar.
3. **The parity test's random sample missed one bucket:**

   ```
   AssertionError: expected Set{ 'admin_review', 'external', …(7) } to deeply equal Set{ 'scheduled', …(9) }
   -   "held_repeat",
   ```

   Every row agreed between SQL and TypeScript. The sample just never held
   an approved, valid draft with a warning. The test now writes every
   combination (72 drafts) instead of a random sample.
4. **My test mistakes, with no product change:**
   - an empty concept list shows a "No concepts yet." row, not zero rows;
   - selecting a concept reorders the list, so the test now finds the card
     by its title;
   - the first full e2e run didn't start, because a server I had stopped
     still held port 3000.

## Acceptance criteria

| # | Criterion | Evidence |
|---|---|---|
| 1 | Fixture with drafts in every state: each counted exactly once; rejected, archived, external, pending and duplicate-of-published never supply | pgTAP: 16 drafts covering every status, plus a lost approval, repetition warnings against a published post, against a published draft, overridden, and against an unpublished draft. Every draft has one row and one bucket, each in the expected bucket, and supply is exactly scheduled plus usable buffer. Unit: 500 random draft sets, where the buckets sum to the drafts, no draft is in two, and nothing outside the two supply buckets is supply. Parity: SQL and TypeScript agree on all 72 combinations of status, external, approval and warning |
| 2 | Invalidating the approval of a scheduled draft immediately changes coverage (scheduled −1, slot open) | pgTAP: an admin edit of a scheduled draft gives scheduled −1, the slot open again and the next open slot, and the draft back in review, not in the buffer |
| 3 | Shortfall when buffer < threshold; replenishment proposes no more than the batch size and nothing when supply is sufficient | Unit: threshold boundaries (below, equal), the 7-day horizon (7 and 8 days), the batch cap on 1,000 random inputs, nothing when the need is 0. e2e: "Buffer low" with nothing approved, a batch of 5 against a need of 20, and the CTO's sufficient supply offering nothing |
| 4 | No action on this page publishes or approves anything | The coverage functions are `stable` (pgTAP) and admin-only. e2e: the only buttons on the page are "Generate N concepts…". The action asks for concepts only and recomputes the need on the server |

### Named tests from PHASES.md

| Test | Where |
|---|---|
| Coverage property tests (random draft sets: buckets sum to live drafts; no item in two buckets) | `lib/domain/coverage.test.ts` |
| SQL vs TypeScript parity | `tests/db/coverage-parity.test.ts` |
| Threshold boundaries | `lib/domain/coverage.test.ts` |
| E2E: dashboard shows a shortfall, admin generates a replenishment batch through the fake provider | `e2e/pipeline.spec.ts` |

## MVP acceptance (PRODUCT_SPEC §12)

Criterion 4 (the coverage dashboard with every measure in §4.4, no double
counting) was the one waiting for this phase. It now has local evidence like
the other eleven (see the table in `phase-9.md`). The definition of done for
the MVP is still all twelve **on staging**, with real accounts.

## Decisions

- **D-35: pipeline management** (in `DECISIONS.md`):
  - the buckets;
  - what counts as a near-duplicate of published content;
  - the thresholds: the shortfall flag counts posts, and "close" means 7 days;
  - replenishment's target month, batch and confirmation;
  - the diversity report;
  - the calendar filters;
  - read-only.
- **DATA_MODEL.md**, "Implemented in Phase 8", lists the differences from
  §12. §12.3 now says what was built.

## Not done, and why

- **The batch size has no setting in the app.** It is set with SQL, like the
  budget. Say if the admin should be able to change it.
- **Replenishment asks for concepts, not drafts.** The spec's "3 drafts"
  batch is covered by drafting the selected concepts on the Concepts page, one
  deliberate click each. The Pipeline links there when concepts are waiting.
- **Performance analytics** are excluded from this phase. The reports page
  from Phase 9 has the manual metrics.
