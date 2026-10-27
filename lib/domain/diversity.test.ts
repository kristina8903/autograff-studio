import { describe, expect, it } from "vitest";
import { NOT_SET, distribution, hotSpots, type DiversityItem } from "./diversity";

const item = (
  id: string,
  founderId: string,
  fingerprint: Record<string, unknown>,
  repetitionWarnings = 0,
): DiversityItem => ({
  id,
  founderId,
  title: `Post ${id}`,
  fingerprint,
  repetitionWarnings,
});

describe("distribution", () => {
  it("counts each value per founder and in total, most used first", () => {
    const items = [
      item("1", "ceo", { format: "story" }),
      item("2", "ceo", { format: "story" }),
      item("3", "cto", { format: "story" }),
      item("4", "cto", { format: "lesson" }),
    ];
    expect(distribution(items, "format")).toEqual([
      { value: "story", total: 3, byFounder: { ceo: 2, cto: 1 } },
      { value: "lesson", total: 1, byFounder: { cto: 1 } },
    ]);
  });

  it("counts every value of a list field once per item, ignoring case", () => {
    const items = [
      item("1", "ceo", { topics: ["Repair cycle time", "repair cycle time", "AI"] }),
      item("2", "cto", { topics: ["AI"] }),
    ];
    expect(distribution(items, "topics")).toEqual([
      { value: "AI", total: 2, byFounder: { ceo: 1, cto: 1 } },
      { value: "Repair cycle time", total: 1, byFounder: { ceo: 1 } },
    ]);
  });

  it("shows content without a fingerprint as not set, and an empty list as nothing", () => {
    const items = [item("1", "ceo", {}), item("2", "ceo", { product_mentions: [] })];
    expect(distribution(items, "cta")).toEqual([{ value: NOT_SET, total: 2, byFounder: { ceo: 2 } }]);
    expect(distribution(items, "product_mentions")).toEqual([{ value: NOT_SET, total: 1, byFounder: { ceo: 1 } }]);
  });
});

describe("hot spots", () => {
  it("finds the same argument across founders", () => {
    const spots = hotSpots([
      item("1", "ceo", { argument_key: "Software should move work forward" }),
      item("2", "cto", { argument_key: "software should move work forward " }),
      item("3", "cto", { argument_key: "Something else" }),
    ]);
    expect(spots).toHaveLength(1);
    expect(spots[0]).toMatchObject({ kind: "same_argument", argument: "Software should move work forward" });
    expect(spots[0].kind === "same_argument" && spots[0].items.map((i) => i.id)).toEqual(["1", "2"]);
  });

  it("flags a value used by more than half of a founder's month, from four items", () => {
    const three = [1, 2, 3].map((n) => item(String(n), "ceo", { hook_type: "question" }));
    expect(hotSpots(three)).toEqual([]);
    const four = [...three, item("4", "ceo", { hook_type: "statistic" })];
    expect(hotSpots(four)).toEqual([
      { kind: "crowded", field: "hook_type", value: "question", founderId: null, count: 3, of: 4 },
      { kind: "crowded", field: "hook_type", value: "question", founderId: "ceo", count: 3, of: 4 },
    ]);
    // Exactly half is not crowded.
    const half = [
      ...[1, 2].map((n) => item(String(n), "ceo", { hook_type: "question" })),
      item("3", "ceo", {}),
      item("4", "ceo", {}),
    ];
    expect(hotSpots(half)).toEqual([]);
  });

  it("lists content with open repetition warnings", () => {
    expect(hotSpots([item("1", "ceo", {}, 2)])).toEqual([
      { kind: "repetition_warning", item: item("1", "ceo", {}, 2) },
    ]);
  });
});
