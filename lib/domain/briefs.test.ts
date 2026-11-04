import { describe, expect, it } from "vitest";
import { diffBriefs, lines, parseBriefForm, type BriefSnapshot } from "./briefs";

const ceo = "00000000-0000-4000-8000-0000000000f1";
const cto = "00000000-0000-4000-8000-0000000000f2";

function form(values: Record<string, string>) {
  const data = new FormData();
  for (const [key, value] of Object.entries(values)) data.set(key, value);
  return data;
}

describe("parseBriefForm", () => {
  it("turns one-item-per-line fields into lists and keeps only filled-in emphasis", () => {
    const result = parseBriefForm(
      form({
        theme: " Operational uncertainty ",
        objectives: "Explain status visibility\n\n  Grow fleet pipeline  ",
        [`emphasis:${ceo}`]: "Why software must move work forward",
        [`emphasis:${cto}`]: "   ",
        approvedFacts: "ShopOS Base is $0/month with ShopOS Payments",
        changeNote: "First draft",
      }),
      [ceo, cto],
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.content.theme).toBe("Operational uncertainty");
    expect(result.data.content.objectives).toEqual(["Explain status visibility", "Grow fleet pipeline"]);
    expect(result.data.content.topicsToAvoid).toEqual([]);
    expect(result.data.founderEmphasis).toEqual({ [ceo]: "Why software must move work forward" });
    expect(result.data.approvedFacts).toHaveLength(1);
  });

  it("requires a theme", () => {
    const result = parseBriefForm(form({ theme: "  " }), []);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.theme).toBe("Enter the month's theme.");
  });

  it("says which limit a list field broke, and where", () => {
    const many = Array.from({ length: 42 }, (_, i) => `Fact ${i + 1}`).join("\n");
    const tooMany = parseBriefForm(form({ theme: "T", approvedFacts: many, objectives: many }), []);
    expect(tooMany.ok).toBe(false);
    if (!tooMany.ok) {
      expect(tooMany.errors.approvedFacts).toMatch(/^This has 42 lines; the limit is 30\./);
      expect(tooMany.errors.objectives).toMatch(/^This has 42 lines; the limit is 30\./);
    }

    const long = parseBriefForm(form({ theme: "T", approvedFacts: `Short\n${"x".repeat(1240)}` }), []);
    expect(long.ok).toBe(false);
    if (!long.ok)
      expect(long.errors.approvedFacts).toMatch(/^Line 2 is 1,240 characters; each line can be up to 1,000\./);

    // Blank lines don't count, and the limits themselves are allowed.
    const atLimit = Array.from({ length: 30 }, () => "y".repeat(1000)).join("\n\n");
    expect(parseBriefForm(form({ theme: "T", approvedFacts: atLimit }), []).ok).toBe(true);
  });

  it("ignores emphasis for founders it was not told about", () => {
    const result = parseBriefForm(form({ theme: "T", [`emphasis:${cto}`]: "x" }), [ceo]);
    expect(result.ok && result.data.founderEmphasis).toEqual({});
  });
});

describe("diffBriefs", () => {
  const empty = {
    secondaryThemes: [],
    objectives: [],
    audiences: [],
    coreArguments: [],
    productUpdates: [],
    industryDevelopments: [],
    contentMix: [],
    topicsToAvoid: [],
    callsToAction: [],
    datesAndEvents: [],
    previousThemesToAvoid: [],
  };
  const v1: BriefSnapshot = { content: { theme: "A", ...empty }, founderEmphasis: { [ceo]: "x" }, approvedFacts: [] };
  it("lists only the fields that changed", () => {
    const v2: BriefSnapshot = {
      content: { theme: "B", ...empty, topicsToAvoid: ["Competitors"] },
      founderEmphasis: { [ceo]: "x" },
      approvedFacts: [],
    };
    expect(diffBriefs(v1, v2).map((c) => c.field)).toEqual(["Theme", "Topics to avoid"]);
  });
  it("names founders in emphasis changes", () => {
    const v2: BriefSnapshot = { ...v1, founderEmphasis: { [ceo]: "y" } };
    expect(diffBriefs(v1, v2, { [ceo]: "Ada (CEO)" })).toEqual([
      { field: "Emphasis: Ada (CEO)", before: ["x"], after: ["y"] },
    ]);
  });
  it("reports nothing for identical versions", () => {
    expect(diffBriefs(v1, structuredClone(v1))).toEqual([]);
  });
});

it("lines() trims and drops blanks", () => {
  expect(lines(" a \n\n b\r\nc ")).toEqual(["a", "b", "c"]);
  expect(lines(null)).toEqual([]);
});
