import { describe, expect, it } from "vitest";
import {
  carryClaims,
  lintDraft,
  metadataLeak,
  modelFlags,
  placeholderFlags,
  reviewClaims,
  reviewDraft,
} from "./draft-review";
import { diffWords } from "./diff";
import { bodyHash, findPlaceholders, normalizeBody } from "./drafts";

const NONE = { avoidPhrases: [], styleRules: [], approvedFacts: [] };

describe("normalizeBody and bodyHash (PRODUCT_SPEC §7.4)", () => {
  it("ignores line endings, trailing spaces and tabs, and outer blank lines", () => {
    const a = "\n\nFirst line  \r\nSecond\t\r\n\r\nThird\n\n";
    expect(normalizeBody(a)).toBe("First line\nSecond\n\nThird");
    expect(bodyHash(a)).toBe(bodyHash("First line\nSecond\n\nThird"));
  });
  it("treats composed and decomposed accents as the same text (NFC)", () => {
    expect(bodyHash("caf\u00e9")).toBe(bodyHash("cafe\u0301"));
  });
  it("counts every other change as material", () => {
    const base = bodyHash("Repairs take time.\n\nAsk why.");
    for (const changed of [
      "Repairs take time!\n\nAsk why.",
      "Repairs take time.\nAsk why.",
      "Repairs  take time.\n\nAsk why.",
      " Repairs take time.\n\nAsk why.",
      "Repairs take time.\n\nAsk why. #fleet",
    ])
      expect(bodyHash(changed), changed).not.toBe(base);
  });
});

describe("placeholders", () => {
  const body = "Last spring [FOUNDER TO SUPPLY: a time a status surprise cost you a day]. Then we changed.";
  it("finds each placeholder and what it asks for", () => {
    expect(findPlaceholders(body)).toEqual([
      { start: 12, end: 72, request: "a time a status surprise cost you a day" },
    ]);
  });
  it("raises one blocking needs-personal-context flag per placeholder", () => {
    expect(placeholderFlags(body)).toEqual([
      {
        kind: "needs_personal_context",
        severity: "blocking",
        source: "placeholder",
        message: "Founder to supply: a time a status surprise cost you a day",
        span_start: 12,
        span_end: 72,
      },
    ]);
  });
});

describe("metadata never belongs in the body", () => {
  it("detects rationale, sources and flag lines", () => {
    for (const body of [
      "Post text.\n\nRationale: chosen for reach",
      "Post.\nSources: example.com",
      "Post.\n**References:** a, b",
      "Post.\nReview flags: none",
      "Post [FLAG: unsupported]",
    ])
      expect(metadataLeak(body), body).not.toBeNull();
  });
  it("allows the words in ordinary sentences", () => {
    expect(metadataLeak("Our rationale was simple: fix the waiting.")).toBeNull();
    expect(metadataLeak("Good sources matter.")).toBeNull();
  });
});

describe("lintDraft", () => {
  it("blocks over-long posts and links that aren't from approved facts", () => {
    const flags = lintDraft(`${"x".repeat(3001)} see https://example.com/stats`, NONE);
    expect(flags.map((f) => [f.kind, f.severity])).toEqual([
      ["style", "blocking"],
      ["unsupported_claim", "blocking"],
    ]);
    expect(
      lintDraft("Pricing: https://autograff.ai/pricing", {
        ...NONE,
        approvedFacts: ["Pricing is listed at https://autograff.ai/pricing"],
      }),
    ).toEqual([]);
  });
  it("warns on stock phrases, the founder's avoid list and em-dashes when the founder avoids them", () => {
    const flags = lintDraft("This is a Game-Changer — honestly, synergy everywhere.", {
      ...NONE,
      avoidPhrases: ["Honestly"],
      styleRules: ["No em-dashes"],
    });
    expect(flags.map((f) => f.message)).toEqual([
      'Avoid "game-changer".',
      'Avoid "synergy".',
      'Avoid "honestly".',
      "This founder doesn't use em-dashes.",
    ]);
    expect(flags.every((f) => f.severity === "warning")).toBe(true);
  });
  it("warns when most paragraphs are a single short line", () => {
    const choppy = ["Repairs wait.", "Parts wait.", "People wait.", "Nobody knows why.", "We fixed that."].join("\n\n");
    expect(lintDraft(choppy, NONE).map((f) => f.message)).toEqual([
      "Most paragraphs are a single short line; the post reads choppy.",
    ]);
    const fine = [
      "Repairs wait on parts. Parts wait on approvals.",
      "Approvals wait on people. People wait on updates.",
      "Nobody knows why.",
    ].join("\n\n");
    expect(lintDraft(fine, NONE)).toEqual([]);
  });
});

describe("reviewClaims (Phase 4 criterion 5)", () => {
  const facts = ["Autograff costs $X per vehicle per month, billed annually"];
  const body =
    "Autograff costs $X per vehicle per month. Repairs take 30% longer than quoted. I think speed matters less than trust.";
  it("supports facts backed by an approved fact and flags every other factual claim as blocking", () => {
    const { records, flags } = reviewClaims(
      body,
      [
        { text: "Autograff costs $X per vehicle per month", kind: "sourced_fact", approved_fact_index: 0 },
        { text: "Repairs take 30% longer than quoted", kind: "sourced_fact", approved_fact_index: null },
        { text: "speed matters less than trust", kind: "opinion", approved_fact_index: null },
        { text: "a made-up fact", kind: "sourced_fact", approved_fact_index: 5 },
      ],
      facts,
    );
    expect(records.map((r) => [r.support_status, r.approved_fact])).toEqual([
      ["supported", facts[0]],
      ["unsupported", null],
      ["not_applicable", null],
      ["unsupported", null],
    ]);
    expect(records[1]).toMatchObject({ span_start: 42, span_end: 77 });
    expect(flags.map((f) => [f.kind, f.severity, f.span_start])).toEqual([
      ["unsupported_claim", "blocking", 42],
      ["unsupported_claim", "blocking", null],
    ]);
  });
  it("blocks first-person experience unless it sits inside a placeholder", () => {
    const text = "We lost a fleet client once. [FOUNDER TO SUPPLY: what you did the day the van was late]";
    const { flags, records } = reviewClaims(
      text,
      [
        { text: "We lost a fleet client once", kind: "founder_experience", approved_fact_index: null },
        { text: "what you did the day the van was late", kind: "founder_experience", approved_fact_index: null },
      ],
      [],
    );
    expect(records.map((r) => r.support_status)).toEqual(["unsupported", "not_applicable"]);
    expect(flags.map((f) => [f.kind, f.severity])).toEqual([["needs_personal_context", "blocking"]]);
  });
});

it("modelFlags: competitor claims and missing context block; the rest warn", () => {
  const flags = modelFlags("Unlike CompetitorCo, we ship daily.", [
    { kind: "competitor_claim", message: "Names a competitor", quote: "Unlike CompetitorCo" },
    { kind: "product_claim", message: "Claims daily shipping", quote: "we ship daily" },
  ]);
  expect(flags.map((f) => [f.kind, f.severity, f.span_start])).toEqual([
    ["competitor_claim", "blocking", 0],
    ["product_claim", "warning", 21],
  ]);
});

it("reviewDraft combines placeholder, claim, model and lint flags", () => {
  const { flags } = reviewDraft({
    body: "[FOUNDER TO SUPPLY: a story] Repairs take 30% longer. Game-changer.",
    claims: [{ text: "Repairs take 30% longer", kind: "sourced_fact", approved_fact_index: null }],
    modelFlags: [],
    approvedFacts: [],
    avoidPhrases: [],
    styleRules: [],
  });
  expect(flags.map((f) => f.source)).toEqual(["placeholder", "claims", "lint"]);
});

it("carryClaims keeps only claims still in the edited text", () => {
  const claims = [
    { text: "Repairs take 30% longer", kind: "sourced_fact" as const, approved_fact_index: null },
    { text: "Trust beats speed", kind: "opinion" as const, approved_fact_index: null },
  ];
  expect(carryClaims("Trust beats speed, always.", claims)).toEqual([claims[1]]);
});

it("diffWords marks added and removed words", () => {
  expect(diffWords("Repairs take time.", "Repairs take too much time.")).toEqual([
    { kind: "same", text: "Repairs take " },
    { kind: "added", text: "too much " },
    { kind: "same", text: "time." },
  ]);
  expect(diffWords("a b", "a c")).toEqual([
    { kind: "same", text: "a " },
    { kind: "removed", text: "b" },
    { kind: "added", text: "c" },
  ]);
});

describe("claims backed by research findings (Phase 5 criterion 3)", () => {
  const findings = [{ id: "f-1", claim: "About 27% of delays came from waiting for approvals in 2025." }];
  const body = "About 27% of repair delays came from waiting for approvals. That is a process problem.";
  const claim = (patch: Partial<{ text: string; finding_index: number | null }>) => ({
    text: "About 27% of repair delays came from waiting for approvals",
    kind: "sourced_fact" as const,
    approved_fact_index: null,
    finding_index: 0,
    ...patch,
  });

  it("a claim citing a verified finding is supported and linked to it", () => {
    const { records, flags } = reviewClaims(body, [claim({})], [], findings);
    expect(records).toEqual([expect.objectContaining({ finding_id: "f-1", support_status: "supported" })]);
    expect(flags).toEqual([]);
  });

  it("a claim whose numbers differ from its finding is unsupported", () => {
    const { records, flags } = reviewClaims(body, [claim({ text: "About 37% of repair delays" })], [], findings);
    expect(records[0]).toMatchObject({ finding_id: null, support_status: "unsupported" });
    expect(flags[0].message).toMatch(/numbers differ/);
  });

  it("a claim citing no finding, or one that isn't offered, is unsupported", () => {
    for (const finding_index of [null, 3]) {
      const { records, flags } = reviewClaims(body, [claim({ finding_index })], [], findings);
      expect(records[0]).toMatchObject({ finding_id: null, support_status: "unsupported" });
      expect(flags[0]).toMatchObject({ kind: "unsupported_claim", severity: "blocking" });
    }
  });
});
