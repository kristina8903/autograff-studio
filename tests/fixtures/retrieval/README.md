# Retrieval fixtures

The expected scores in `lib/domain/retrieval.test.ts` were worked out by hand.
This file shows the working.

## The rule (decision D-25)

Only a founder's own examples that are **approved for voice** and **not held
out for evaluation** can be retrieved. Each one gets four scores between 0 and 1:

| Part | Value |
|---|---|
| format | 1 if the example has the concept's format, else 0 (0 when the concept has no format) |
| topics | share of the concept's topics the example also has (case-insensitive) |
| text | share of the concept text's terms that appear in the example |
| recency | 180 / (180 + age in days), using the published date, else the date added |

Score = 3 × format + 2 × topics + 2 × text + 1 × recency, rounded to six
decimals. The order is score (high first), then date (newest first), then id.
The top 5 are used.

**Terms** are lower-case words of three or more letters, without common words
(the, and, when, will, for…), with simple plurals folded ("repairs" →
"repair", "stories" → "story"; words of four letters or fewer stay as they are).

## Fixture

Query: format **story**, topics **[Fleet Maintenance]**, text "When will the
repair be finished? Status updates for fleet vans", today **2026-10-21**.

Query terms: when, will, the, be, for are dropped; status → `statu`, updates
→ `update`, vans stays (four letters). Terms: {repair, finished, statu,
update, fleet, vans}, which is **6**.

| Example | Format | Topics | Text terms shared | Age | Score |
|---|---|---|---|---|---|
| A: story, {repair status, fleet maintenance}, "The hardest part of a repair is not knowing when the van comes back.", published 2026-10-21 | 1 | 1/1 = 1 | repair (van ≠ vans): 1/6 | 0 → 1 | 3 + 2 + 0.333333 + 1 = **6.333333** |
| C: story, no topics, "Our first customer called every day asking about status.", added 2025-10-21 | 1 | 0 | statu: 1/6 | 365 → 180/545 = 0.330275 | 3 + 0.333333 + 0.330275 = **3.663609** |
| B: list, {repair operations}, "Three numbers every shop should track: cycle time, parts wait, update calls.", published 2026-04-24 | 0 | 0 | update: 1/6 | 180 → 0.5 | 0.333333 + 0.5 = **0.833333** |

Not retrievable at all: the same text as A but for another founder, not
approved, or held out. Expected order: **A, C, B**; top 2: A, C.

**Tie-break fixture.** With no format, topics or text, only recency counts.
Two examples added on 2026-10-01 ("z" and "m") outrank C (2025-10-21), and
between themselves the lower id comes first: **m, z, c**.
