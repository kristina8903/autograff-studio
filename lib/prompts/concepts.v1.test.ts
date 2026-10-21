import { describe, expect, it } from "vitest";
import { readSnapshot } from "@/lib/domain/briefs";
import { promptText } from "@/lib/providers/llm/types";
import { buildConceptPrompt, conceptRecordSchema, type ConceptPromptInput } from "./concepts.v1";

const CEO = "00000000-0000-4000-8000-0000000000f1";
const COO = "00000000-0000-4000-8000-0000000000f3";

const input: ConceptPromptInput = {
  founder: { displayName: "Local CEO", roleTitle: "CEO" },
  founderId: CEO,
  monthLabel: "November 2026",
  brief: {
    ...readSnapshot({
      content: { theme: "Operational uncertainty in vehicle repair", topicsToAvoid: ["Naming competitors"] },
      founder_emphasis: { [CEO]: "Software must help work progress", [COO]: "COO-only emphasis" },
      approved_facts: ["Pricing starts at $X per vehicle per month, billed annually"],
    }),
    versionNo: 3,
  },
  voiceContext: "# Founder voice: Local CEO (CEO)\nWrite in the first person only about: repair operations.",
  existing: [{ title: "Why status updates fail", coreArgument: "Updates are pushed, not pulled", status: "selected" }],
  otherFounders: [{ roleTitle: "COO", title: "Shop-floor boards" }],
  count: 6,
};

describe("buildConceptPrompt", () => {
  const prompt = buildConceptPrompt(input);
  const text = promptText({ ...prompt, untrustedContext: [] });

  it("includes the brief version, theme, topics to avoid, this founder's emphasis and approved facts", () => {
    expect(text).toContain("brief version 3");
    expect(text).toContain("Theme: Operational uncertainty in vehicle repair");
    expect(text).toContain("- Naming competitors");
    expect(text).toContain("This founder's emphasis: Software must help work progress");
    expect(text).toContain("Pricing starts at $X per vehicle per month, billed annually");
  });

  it("never includes another founder's emphasis", () => {
    expect(text).not.toContain("COO-only emphasis");
  });

  it("includes the voice and the concepts to avoid repeating", () => {
    expect(text).toContain("Write in the first person only about: repair operations.");
    expect(text).toContain("[selected] Why status updates fail: Updates are pushed, not pulled");
    expect(text).toContain("- COO: Shop-floor boards");
  });

  it("asks for an exact count, or one replacement with the admin's guidance", () => {
    expect(prompt.instruction).toMatch(/^Propose exactly 6 concepts for Local CEO \(CEO\) for November 2026\./);
    const regen = buildConceptPrompt({
      ...input,
      replacing: { title: "Old", coreArgument: "Old argument", guidance: "More practical" },
    });
    expect(regen.instruction).toMatch(/^Propose exactly 1 concept for Local CEO to replace "Old"/);
    expect(regen.instruction).toContain("The admin's guidance: More practical");
  });

  it("tells the model not to invent facts", () => {
    expect(prompt.system).toContain("Never invent facts.");
  });
});

it("conceptRecordSchema enforces the database's length limits", () => {
  const ok = {
    title: "T",
    audience: "",
    core_argument: "A",
    hook: "",
    format: "story",
    why_this_founder: "",
    evidence_requirements: [],
    needs_personal_story: false,
    fingerprint: {
      topics: [],
      argument_key: "k",
      hook_type: "question",
      audience: "",
      product_mentions: [],
      cta: "none",
    },
  };
  expect(conceptRecordSchema.safeParse(ok).success).toBe(true);
  expect(conceptRecordSchema.safeParse({ ...ok, title: "x".repeat(201) }).success).toBe(false);
  expect(conceptRecordSchema.safeParse({ ...ok, core_argument: " " }).success).toBe(false);
});
