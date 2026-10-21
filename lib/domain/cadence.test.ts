import { describe, expect, it } from "vitest";
import { describeRule, generateSlots, monthTargets, validateRule, type CadenceRule } from "./cadence";
import { isoWeekNumber, localToday } from "./dates";

// Fixtures are hand-computed; see tests/fixtures/cadence/README.md.
const TUE = 2;
const WED = 3;
const THU = 4;

function rule(overrides: Partial<CadenceRule> = {}): CadenceRule {
  return {
    id: "r1",
    effectiveFrom: "2020-01-01",
    effectiveTo: null,
    period: "week",
    minPosts: 2,
    maxPosts: 3,
    weeklyPattern: null,
    publishingDays: [TUE, WED, THU],
    reservedTimelySlotsPerMonth: 0,
    ...overrides,
  };
}

const ceo = rule();
const cto = rule({ id: "cto", period: "month", minPosts: 2, maxPosts: 2 });
const dates = (slots: { date: string }[]) => slots.map((s) => s.date);

describe("weekly cadence: CEO 2–3 posts a week on Tue, Wed, Thu", () => {
  it("month starting on a Sunday (Nov 2026: 4 Tue/Wed/Thu)", () => {
    expect(monthTargets([ceo], "2026-11")).toEqual({ min: 8, target: 12, max: 12 });
    expect(dates(generateSlots([ceo], "2026-11"))).toEqual([
      "2026-11-03",
      "2026-11-04",
      "2026-11-05",
      "2026-11-10",
      "2026-11-11",
      "2026-11-12",
      "2026-11-17",
      "2026-11-18",
      "2026-11-19",
      "2026-11-24",
      "2026-11-25",
      "2026-11-26",
    ]);
  });

  it("month starting on a Saturday (Aug 2026)", () => {
    expect(monthTargets([ceo], "2026-08")).toEqual({ min: 8, target: 12, max: 12 });
    expect(dates(generateSlots([ceo], "2026-08"))[0]).toBe("2026-08-04");
  });

  it("February in a non-leap year (2026) and a leap year (2028, starts on a Tuesday)", () => {
    expect(monthTargets([ceo], "2026-02")).toEqual({ min: 8, target: 12, max: 12 });
    // 2028-02 has five Tuesdays (1, 8, 15, 22, 29) and four Wednesdays and Thursdays.
    expect(monthTargets([ceo], "2028-02")).toEqual({ min: 9, target: 13, max: 13 });
    expect(dates(generateSlots([ceo], "2028-02")).at(-1)).toBe("2028-02-29");
  });

  it("31-day month spanning five partial ISO weeks (Dec 2026)", () => {
    expect(monthTargets([ceo], "2026-12")).toEqual({ min: 10, target: 15, max: 15 });
    const slots = dates(generateSlots([ceo], "2026-12"));
    expect(slots.slice(0, 3)).toEqual(["2026-12-01", "2026-12-02", "2026-12-03"]);
    expect(slots.slice(-3)).toEqual(["2026-12-29", "2026-12-30", "2026-12-31"]);
  });

  it("an ISO week spanning two months puts each slot only in its own month", () => {
    // Week of Mon 28 Sep 2026: Tue 29 and Wed 30 are September, Thu 1 Oct is October.
    const september = dates(generateSlots([ceo], "2026-09"));
    const october = dates(generateSlots([ceo], "2026-10"));
    expect(september).toContain("2026-09-29");
    expect(september).toContain("2026-09-30");
    expect(september).not.toContain("2026-10-01");
    expect(october[0]).toBe("2026-10-01");
    expect(september.filter((d) => october.includes(d))).toEqual([]);
  });
});

describe("weekly pattern [3, 2] alternates by ISO week across a month boundary", () => {
  const alternating = rule({ weeklyPattern: [3, 2] });
  it("uses the ISO week number, so the pattern continues from September into October", () => {
    expect(isoWeekNumber("2026-09-28")).toBe(40); // even → pattern[0] = 3
    expect(isoWeekNumber("2026-10-05")).toBe(41); // odd → pattern[1] = 2
    expect(dates(generateSlots([alternating], "2026-10"))).toEqual([
      "2026-10-01", // week 40 (3 posts: Sep 29, Sep 30, Oct 1)
      "2026-10-06",
      "2026-10-07", // week 41: 2
      "2026-10-13",
      "2026-10-14",
      "2026-10-15", // week 42: 3
      "2026-10-20",
      "2026-10-21", // week 43: 2
      "2026-10-27",
      "2026-10-28",
      "2026-10-29", // week 44: 3
    ]);
    expect(dates(generateSlots([alternating], "2026-09")).slice(-2)).toEqual(["2026-09-29", "2026-09-30"]);
  });
  it("target follows the pattern; min and max follow the rule's limits", () => {
    // min (2 a week, Tue+Wed): the week of 28 Sep puts both in September, so 4 weeks × 2 = 8.
    expect(monthTargets([alternating], "2026-10")).toEqual({ min: 8, target: 11, max: 13 });
  });
});

describe("monthly cadence: CTO 2 posts a month", () => {
  it("spreads two slots evenly over the preferred days (weeks 2 and 4)", () => {
    expect(dates(generateSlots([cto], "2026-11"))).toEqual(["2026-11-10", "2026-11-24"]);
    expect(monthTargets([cto], "2026-11")).toEqual({ min: 2, target: 2, max: 2 });
  });
  it("works when the only preferred day occurs just four times", () => {
    const tuesdaysOnly = rule({ id: "cto", period: "month", minPosts: 2, maxPosts: 2, publishingDays: [TUE] });
    expect(dates(generateSlots([tuesdaysOnly], "2026-11"))).toEqual(["2026-11-10", "2026-11-24"]);
  });
});

describe("reserved timely slots", () => {
  it("carve reserved slots out of the regular ones without changing the target", () => {
    const withReserved = rule({ reservedTimelySlotsPerMonth: 2 });
    const slots = generateSlots([withReserved], "2026-11");
    expect(slots).toHaveLength(12);
    expect(slots.filter((s) => s.kind === "reserved_timely").map((s) => s.date)).toEqual(["2026-11-11", "2026-11-19"]);
    expect(monthTargets([withReserved], "2026-11").target).toBe(12);
  });
  it("never reserves more slots than exist", () => {
    const greedy = rule({ id: "cto", period: "month", minPosts: 2, maxPosts: 2, reservedTimelySlotsPerMonth: 5 });
    expect(generateSlots([greedy], "2026-11").every((s) => s.kind === "reserved_timely")).toBe(true);
  });
});

describe("cadence change mid-month", () => {
  it("each date uses the rule in effect on that date", () => {
    const before = rule({ id: "a", minPosts: 2, maxPosts: 2, publishingDays: [TUE, WED], effectiveTo: "2026-11-16" });
    const after = rule({ id: "b", effectiveFrom: "2026-11-16" });
    const slots = generateSlots([before, after], "2026-11");
    expect(slots.map((s) => `${s.date}:${s.ruleId}`)).toEqual([
      "2026-11-03:a",
      "2026-11-04:a",
      "2026-11-10:a",
      "2026-11-11:a",
      "2026-11-17:b",
      "2026-11-18:b",
      "2026-11-19:b",
      "2026-11-24:b",
      "2026-11-25:b",
      "2026-11-26:b",
    ]);
  });
  it("a monthly rule covering half the month gets about half its posts", () => {
    const halfMonth = rule({ id: "cto", period: "month", minPosts: 4, maxPosts: 4, effectiveFrom: "2026-11-16" });
    expect(generateSlots([halfMonth], "2026-11")).toHaveLength(2);
  });
});

describe("determinism", () => {
  it("is idempotent: the same rules and month always give the same slots", () => {
    const rules = [rule({ reservedTimelySlotsPerMonth: 1, weeklyPattern: [3, 2] })];
    expect(generateSlots(rules, "2026-12")).toEqual(generateSlots(rules, "2026-12"));
  });
  it("is unaffected by daylight-saving changes (US DST starts 8 Mar 2026)", () => {
    expect(dates(generateSlots([ceo], "2026-03")).slice(3, 6)).toEqual(["2026-03-10", "2026-03-11", "2026-03-12"]);
  });
});

describe("founder-local today across DST changes", () => {
  it("America/Los_Angeles on the night DST ends (1 Nov 2026, 09:00 UTC)", () => {
    expect(localToday("America/Los_Angeles", new Date("2026-11-01T06:59:00Z"))).toBe("2026-10-31");
    expect(localToday("America/Los_Angeles", new Date("2026-11-01T08:30:00Z"))).toBe("2026-11-01");
    expect(localToday("America/Los_Angeles", new Date("2026-11-02T07:30:00Z"))).toBe("2026-11-01");
  });
  it("Europe/London on the night BST ends (25 Oct 2026, 01:00 UTC)", () => {
    expect(localToday("Europe/London", new Date("2026-10-24T22:59:00Z"))).toBe("2026-10-24");
    expect(localToday("Europe/London", new Date("2026-10-24T23:30:00Z"))).toBe("2026-10-25");
  });
});

describe("validateRule", () => {
  const valid = ceo; // validateRule ignores the id
  it("accepts the default presets", () => {
    expect(validateRule(valid)).toEqual([]);
    expect(validateRule(cto)).toEqual([]);
  });
  it("rejects impossible rules", () => {
    expect(validateRule({ ...valid, minPosts: 0 })).not.toEqual([]);
    expect(validateRule({ ...valid, maxPosts: 1 })).not.toEqual([]);
    expect(validateRule({ ...valid, publishingDays: [] })).not.toEqual([]);
    expect(validateRule({ ...valid, publishingDays: [2, 2, 3] })).not.toEqual([]);
    expect(validateRule({ ...valid, maxPosts: 4 })).not.toEqual([]); // 4 a week on 3 days
    expect(validateRule({ ...valid, weeklyPattern: [3, 1] })).not.toEqual([]);
    expect(validateRule({ ...valid, effectiveTo: "2019-12-31" })).not.toEqual([]);
  });
});

it("describes rules in plain language", () => {
  expect(describeRule(ceo)).toBe("2–3 posts a week on Tue, Wed, Thu");
  expect(describeRule(cto)).toBe("2 posts a month on Tue, Wed, Thu");
});
