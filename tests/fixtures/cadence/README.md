# Cadence fixtures

The expected values in `lib/domain/cadence.test.ts` were worked out by hand
from a calendar. They are not copied from the code's output. This file
explains how each one was computed, so a reviewer can check them without
running anything.

## The rules being tested

- **Weekly rule.** Each ISO week (Monday to Sunday) gets *N* posts on the
  first *N* preferred weekdays of that week, where *N* comes from
  `weekly_pattern[isoWeek % length]` if set, else `max_posts`. A week that
  spans two months is split: each slot belongs to the month of its own date.
  The month's **min** and **max** use the same rule with `min_posts` and
  `max_posts`.
- **Monthly rule.** *N* is `max_posts` (target and max) or `min_posts`
  (min). The month's preferred-day dates are listed in order, and
  *N* of them are picked at the midpoints of *N* equal segments. Element
  `floor((i + 0.5) × count / N)` is picked for i = 0 … N−1. A rule covering
  only part of the month gets a share of *N* proportional to the days it
  covers, rounded.
- **Reserved timely slots.** *R* of the month's *n* slots are marked
  `reserved_timely`: those at index `floor((i + 1) × n / (R + 1))` for
  i = 0 … R−1 (evenly spaced, never the first or last). They replace regular
  slots, so the total, and the target, are unchanged.
- **Rule changes.** Each date uses the rule in effect on that date
  (`effective_from` inclusive, `effective_to` exclusive).
- Slots are calendar dates in the founder's time zone. Date arithmetic is in
  UTC, so daylight-saving changes cannot move a slot.

Defaults used below: CEO/COO = 2–3 a week on Tue, Wed, Thu. CTO = 2 a month
on Tue, Wed, Thu.

## Fixtures

| Fixture | Calendar facts | Expected |
|---|---|---|
| CEO, Nov 2026 (starts Sunday) | Tue/Wed/Thu fall on 3–5, 10–12, 17–19, 24–26 | 12 slots; min 4×2 = 8, target = max = 4×3 = 12 |
| CEO, Aug 2026 (starts Saturday) | First Tuesday is Aug 4; four full Tue–Thu weeks | {8, 12, 12}; first slot Aug 4 |
| CEO, Feb 2026 (not a leap year) | Four Tue/Wed/Thu each | {8, 12, 12} |
| CEO, Feb 2028 (leap year, starts Tuesday) | Tuesdays 1, 8, 15, 22, 29; four Wed and four Thu. The week of the 29th has only a Tuesday in February | max = 4×3 + 1 = 13; min = 4×2 + 1 = 9; last slot Feb 29 |
| CEO, Dec 2026 (five partial ISO weeks) | Dec 1 is a Tuesday and Dec 31 a Thursday, so five Tue–Thu weeks fit | {10, 15, 15}; first 1–3 Dec, last 29–31 Dec |
| ISO week spanning months | The week of Mon 28 Sep 2026 has Tue 29 and Wed 30 Sep, and Thu 1 Oct | Sep 29 and 30 count in September; Oct 1 in October; no date in both |
| Pattern [3, 2], Oct 2026 | ISO weeks 40 (even, 3 posts: Sep 29, Sep 30, **Oct 1**), 41 (2), 42 (3), 43 (2), 44 (3) | 1 + 2 + 3 + 2 + 3 = **11** slots. Max 13 (3 a week: 1 + 3×4). Min 8 (2 a week: week 40's two posts are Sep 29–30, then 4 weeks × 2) |
| CTO, Nov 2026 | Tue/Wed/Thu dates: 12 of them. Midpoints of 2 segments: index 3 (Nov 10) and index 9 (Nov 24) | Nov 10, Nov 24 |
| CTO on Tuesdays only, Nov 2026 | Tuesdays 3, 10, 17, 24 (four). Midpoints: index 1 and 3 | Nov 10, Nov 24 |
| CEO with 2 reserved, Nov 2026 | 12 slots; indices floor(12/3) = 4 (Nov 11) and floor(24/3) = 8 (Nov 19) | Reserved Nov 11 and Nov 19; still 12 slots; target 12 |
| Mid-month change, Nov 2026 | Rule *a* (2 a week, Tue/Wed) until Nov 16; rule *b* (3 a week, Tue/Wed/Thu) from Nov 16 | *a*: 3, 4, 10, 11. *b*: 17–19, 24–26 |
| Monthly rule from Nov 16 | Covers 15 of 30 days; 4 × 15/30 = 2 | 2 slots |
| DST, Mar 2026 | US DST starts Sun Mar 8 | Tue/Wed/Thu of the next week are still Mar 10–12 |
| `localToday`, Los Angeles | 1 Nov 2026 09:00 UTC is 01:00 PST, after DST ends | 2026-11-01 |
| `localToday`, London | 25 Oct 2026 01:00 UTC is 01:00 GMT, after BST ends | 2026-10-25 |

## Database side

`supabase/tests/database/02_strategy_cadence.test.sql` covers what the
database enforces: overlapping rules are rejected by the exclusion
constraint, planning is idempotent, slots outside any rule are rejected, and
past, filled, skipped and manual slots survive re-planning. Its dates are
relative to `current_date`, so it does not age.

`tests/db/coverage-parity.test.ts` plans a month for the seeded COO, then
checks that the SQL counts (`coverage_slot_counts`) and the TypeScript
`coverage()` give the same numbers after skips and manual slots.
