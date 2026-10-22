import { describe, expect, it } from "vitest";
import { average, groupBy, parseMetrics, publishedPerMonth, type PublicationRow } from "./reports";

const founders = [
  { id: "ceo", timezone: "America/Los_Angeles" },
  { id: "cto", timezone: "Europe/Berlin" },
];
const row = (patch: Partial<PublicationRow>): PublicationRow => ({
  founderId: "ceo",
  publishedAt: "2026-11-03T17:00:00Z",
  isExternal: false,
  format: "story",
  theme: "Repair delays",
  metrics: null,
  ...patch,
});

describe("publishedPerMonth", () => {
  it("counts studio and external posts per founder, in the founder's own calendar month", () => {
    const rows = [
      row({}),
      row({ isExternal: true, format: null, theme: null }),
      // 2026-12-01 03:00 UTC is still November 30 in Los Angeles.
      row({ publishedAt: "2026-12-01T03:00:00Z" }),
      // …but already December 1 in Berlin.
      row({ founderId: "cto", publishedAt: "2026-11-30T23:30:00Z" }),
      row({ founderId: "unknown" }),
    ];
    expect(publishedPerMonth(rows, founders)).toEqual([
      { founderId: "ceo", month: "2026-11", studio: 2, external: 1, total: 3 },
      { founderId: "cto", month: "2026-12", studio: 1, external: 0, total: 1 },
    ]);
  });
});

describe("groupBy", () => {
  const rows = [
    row({ metrics: { impressions: 1000, reactions: 40 } }),
    row({ metrics: { impressions: 3000 } }),
    row({ format: "opinion", metrics: null }),
    row({ isExternal: true, format: null, theme: null, metrics: { reactions: 10 } }),
  ];

  it("counts each group once, and averages each metric only over posts that recorded it", () => {
    const byFormat = groupBy(rows, (r) => r.format);
    expect(byFormat.map((g) => [g.key, g.published, g.withMetrics])).toEqual([
      ["story", 2, 2],
      ["opinion", 1, 0],
      ["Outside the studio", 1, 1],
    ]);
    const story = byFormat[0];
    expect(average(story, "impressions")).toBe(2000);
    // One of the two story posts recorded reactions: the average is 40, not 20.
    expect(average(story, "reactions")).toBe(40);
    expect(average(byFormat[1], "impressions")).toBeNull();
  });

  it("every publication lands in exactly one group", () => {
    for (const field of [
      (r: PublicationRow) => r.format,
      (r: PublicationRow) => r.theme,
      (r: PublicationRow) => r.founderId,
    ])
      expect(groupBy(rows, field).reduce((n, g) => n + g.published, 0)).toBe(rows.length);
  });
});

describe("parseMetrics", () => {
  it("takes whole non-negative numbers for known metrics, ignoring blanks", () => {
    expect(parseMetrics({ impressions: "1,200", reactions: "45", comments: "", other: "9" })).toEqual({
      metrics: { impressions: 1200, reactions: 45 },
    });
  });
  it("refuses fractions, negatives, text and an empty entry", () => {
    expect(parseMetrics({ reactions: "4.5" })).toEqual({ error: "reactions must be a whole number." });
    expect(parseMetrics({ comments: "-1" })).toMatchObject({ error: expect.any(String) });
    expect(parseMetrics({ impressions: "lots" })).toMatchObject({ error: expect.any(String) });
    expect(parseMetrics({})).toEqual({ error: "Enter at least one number." });
  });
});
