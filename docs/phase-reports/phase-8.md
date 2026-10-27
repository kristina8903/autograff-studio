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

RESULTS

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
