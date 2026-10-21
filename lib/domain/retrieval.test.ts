import { describe, expect, it } from "vitest";
import { retrieveExamples, scoreExample, terms, type RetrievableExample, type RetrievalQuery } from "./retrieval";

// Hand-computed fixtures; the working is in tests/fixtures/retrieval/README.md.
const F = "founder-f";
const base = {
  founderId: F,
  topics: [] as string[],
  publishedAt: null,
  createdAt: "2026-01-01",
  approvedForVoice: true,
  evalHoldout: false,
};

const A: RetrievableExample = {
  ...base,
  id: "a",
  format: "story",
  topics: ["repair status", "fleet maintenance"],
  body: "The hardest part of a repair is not knowing when the van comes back.",
  publishedAt: "2026-10-21",
};
const B: RetrievableExample = {
  ...base,
  id: "b",
  format: "list",
  topics: ["repair operations"],
  body: "Three numbers every shop should track: cycle time, parts wait, update calls.",
  publishedAt: "2026-04-24",
};
const C: RetrievableExample = {
  ...base,
  id: "c",
  format: "story",
  body: "Our first customer called every day asking about status.",
  createdAt: "2025-10-21",
};
const otherFounder: RetrievableExample = { ...A, id: "d", founderId: "founder-g" };
const notApproved: RetrievableExample = { ...A, id: "e", approvedForVoice: false };
const heldOut: RetrievableExample = { ...A, id: "h", evalHoldout: true };

const query: RetrievalQuery = {
  founderId: F,
  format: "story",
  topics: ["Fleet Maintenance"],
  text: "When will the repair be finished? Status updates for fleet vans",
  today: "2026-10-21",
};

describe("terms", () => {
  it("drops short and common words and folds simple plurals", () => {
    expect([...terms(query.text)].sort()).toEqual(["finished", "fleet", "repair", "statu", "update", "vans"]);
  });
});

describe("scoreExample", () => {
  it("scores each part between 0 and 1 and weights them 3/2/2/1", () => {
    expect(scoreExample(A, query)).toEqual({
      score: 6.333333,
      parts: { format: 1, topics: 1, text: 1 / 6, recency: 1 },
    });
    expect(scoreExample(B, query)).toEqual({
      score: 0.833333,
      parts: { format: 0, topics: 0, text: 1 / 6, recency: 0.5 },
    });
    expect(scoreExample(C, query)).toEqual({
      score: 3.663609,
      parts: { format: 1, topics: 0, text: 1 / 6, recency: 180 / 545 },
    });
  });
});

describe("retrieveExamples", () => {
  const all = [B, heldOut, otherFounder, C, notApproved, A];

  it("returns only the founder's approved, non-held-out examples, best first", () => {
    expect(retrieveExamples(all, query, 10).map((r) => r.example.id)).toEqual(["a", "c", "b"]);
  });

  it("returns the top N", () => {
    expect(retrieveExamples(all, query, 2).map((r) => r.example.id)).toEqual(["a", "c"]);
    expect(retrieveExamples(all, query, 0)).toEqual([]);
  });

  it("never returns a held-out example, even when it is the best match", () => {
    const ids = retrieveExamples([heldOut], query).map((r) => r.example.id);
    expect(ids).toEqual([]);
  });

  it("breaks ties by most recent, then by id", () => {
    const newer = { ...C, id: "z", createdAt: "2026-10-01" };
    const sameDateLowerId = { ...C, id: "m", createdAt: "2026-10-01" };
    const noMatch: RetrievalQuery = { ...query, format: null, topics: [], text: "" };
    // Equal recency for "z" and "m" (same date): id decides. "c" is older.
    expect(retrieveExamples([C, newer, sameDateLowerId], noMatch).map((r) => r.example.id)).toEqual(["m", "z", "c"]);
  });

  it("gives no format credit when the query has no format", () => {
    const [first] = retrieveExamples([A], { ...query, format: null });
    expect(first.parts.format).toBe(0);
  });

  it("is deterministic regardless of input order", () => {
    const forward = retrieveExamples(all, query).map((r) => r.example.id);
    const backward = retrieveExamples([...all].reverse(), query).map((r) => r.example.id);
    expect(backward).toEqual(forward);
  });
});
