# Phase 2 report: monthly strategy and cadence

Date: 2026-10-21. Scope:
[PHASES.md, Phase 2](../PHASES.md#phase-2-monthly-strategy-and-cadence).
Built and tested locally. It reaches staging when the pull request is merged:
the migration is applied by the staging migration workflow, and Vercel deploys
the app.

## What was built

| Area | Where |
|---|---|
| Database: `monthly_briefs`, immutable `brief_versions`, effective-dated `cadence_rules` (overlaps rejected by an exclusion constraint), `calendar_slots` (unique per founder, date and ordinal). RLS on every table; all writes through audited functions | `supabase/migrations/20261021000002_strategy_cadence.sql` |
| Slot dates, monthly min/target/max, plain-language cadence summary | `lib/domain/cadence.ts`, `lib/domain/dates.ts` |
| Coverage formula (draft buckets at zero until Phase 4) and its SQL counterpart `coverage_slot_counts` | `lib/domain/coverage.ts` |
| Brief content schema, form parsing, version diff | `lib/domain/briefs.ts` |
| Planning: compute a month's slots and hand them to `sync_calendar_slots`; re-plan the affected months after a cadence change | `lib/server/planning.ts`, `app/admin/planning-actions.ts` |
| Admin: briefs list, brief editor (structured fields, emphasis per founder, approved facts), version history and diff | `app/admin/briefs/` |
| Admin: cadence editor on each founder's page, with the CEO/COO and CTO presets and the slots each month requires | `app/admin/founders/[id]/` |
| Admin: publishing calendar (month grid, per founder or combined), coverage table, plan a month, add a one-off slot, move, skip, restore or remove a slot | `app/admin/calendar/` |
| Founder dashboard: upcoming slots, and each brief's theme with only their own emphasis | `app/dashboard/page.tsx` |
| Local seed: default cadences (CEO and COO 2–3 a week, CTO 2 a month) and a sample November brief | `supabase/seed.sql` |
| Fixture explanations | `tests/fixtures/cadence/README.md` |

## Test results (final run, 2026-10-21)

| Command | Result |
|---|---|
| `npm run check` (typegen + typecheck, ESLint + public-env check, Prettier, Vitest) | pass; **61/61** unit tests (29 from Phase 1, 32 new) |
| `npm run test:db` (reset, pgTAP, then SQL/TypeScript parity) | pgTAP **141/141** (80 Phase 1 + 61 new); parity **1/1** |
| `PLAYWRIGHT_CHROMIUM_EXECUTABLE=/opt/pw-browsers/chromium npm run test:e2e` | **17/17** (11 Phase 1 + 6 new), zero CSP violations |
| `npm run build` | pass; every route renders per request |
| `npm audit --omit=dev` | 0 vulnerabilities |

No test failed in the final run. Failures met during the build are listed
under "Findings" below.

### Phase 2 acceptance criteria

| # | Criterion | Evidence |
|---|---|---|
| 1 | Saving a brief creates v(n+1); earlier versions stay readable and unchanged | e2e "saving a brief creates a new version…"; pgTAP: versions cannot be updated or deleted, even by the owner |
| 2 | Slot generation matches hand-computed fixtures and is idempotent | unit tests in `cadence.test.ts` (fixtures explained in `tests/fixtures/cadence/README.md`); pgTAP and e2e: planning twice adds nothing |
| 3 | A cadence change from date D regenerates only open slots on or after D; filled or past slots untouched and reported | e2e "changing a cadence re-plans only from its start date"; pgTAP: past, filled, skipped and manual slots survive; filled slots outside the new cadence returned in `outside_cadence` |
| 4 | Coverage shows required slots (min, target, max) per founder per month | Calendar coverage table and founder page; e2e "each founder's cadence shows the slots it requires" |

### Named fixtures from PHASES.md

| Fixture | Test |
|---|---|
| CEO 2–3/week: month starting Sunday, starting Saturday, Feb non-leap and leap, 31-day month with five partial weeks | `cadence.test.ts`, "weekly cadence" |
| ISO week spanning two months | "an ISO week spanning two months…" |
| `weekly_pattern [3,2]` across a month boundary | "weekly pattern [3, 2]…" |
| Time zone across DST (Los Angeles, London) | "founder-local today across DST changes"; "unaffected by daylight-saving changes" |
| CTO 2/month on preferred days; preferred day only 4 times | "monthly cadence" |
| Reserved timely slots reduce regular slots, not the target | "reserved timely slots" |
| Mid-month change; overlapping rules rejected | "cadence change mid-month"; pgTAP exclusion-constraint test |
| SQL and TypeScript coverage agree | `tests/db/coverage-parity.test.ts` |

### Access control (pgTAP)

- Anonymous users cannot read any of the four tables or call `founder_brief`.
- Founders cannot read briefs directly. `founder_brief` returns only the
  theme and their own emphasis; the e2e test confirms a founder does not see
  another founder's emphasis or the approved facts.
- Founder A cannot see founder B's cadence or slots.
- Founders cannot write anything.
- An admin without two-factor sign-in has no admin rights here either.

## Decisions

- **D-23:** slot dates are computed in TypeScript; the database validates and
  applies them. Coverage counts slots in SQL now, and the full `app.coverage`
  view comes in Phase 4.
- **D-24:** moving a cadence slot skips it and adds a manual one; skipped
  slots don't count toward the month.

The data-model differences from the Phase 0 proposal are listed at the top of
[DATA_MODEL.md](../DATA_MODEL.md).

## Findings during the build

1. **Hand fixture corrected.** For pattern [3, 2] in October 2026, the minimum
   is 8, not 9. The ISO week of Sep 28 puts both of its minimum posts (Tue and
   Wed) in September. The code was right and the first hand count was wrong.
   The README shows the working.
2. **Generated database types reject `null`** for nullable function
   parameters. A small `sqlNull` helper in the actions passes SQL nulls
   without loosening the types.
3. **The cadence form lost typed input** when it was remounted on blur. It now
   resets only when a preset is chosen.

## Not done, and why

- **Staging data.** The seed does not run on staging. After merging, the
  admin sets each founder's cadence with the presets and plans the month.
  There is a short list below.
- **Preferred posting time** is stored but not used until scheduling
  (Phase 7).
- **Draft buckets in coverage** stay at zero until drafts exist (Phase 4).
- **Carried over from Phase 1:** Vercel deployment protection should be
  previews-only before founders are invited; the restore drill; preview
  environment variables.

## After merging: staging steps

1. Check the "Migrate staging database" workflow run on `main` is green (or that the
   Supabase GitHub integration applied the migration).
2. In Studio, open **Founders & team**, then each founder, and save their
   cadence (presets: "2–3 a week" for CEO/COO, "2 a month" for CTO).
3. Open **Calendar** and click **Plan slots** for the current and next month.
4. Open **Briefs** and write the next month's brief.
