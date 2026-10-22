// npm run eval:generation — one real concept batch and one real draft from the
// fixed fixture, checked against the same rules as production. Hard cap: $1.
import { describe, expect, it } from "vitest";
import { metadataLeak, reviewDraft } from "@/lib/domain/draft-review";
import { findPlaceholders } from "@/lib/domain/drafts";
import { buildConceptPrompt, conceptBatchSchema, CONCEPTS_MAX_OUTPUT_TOKENS } from "@/lib/prompts/concepts.v2";
import { buildDraftPrompt, draftRecordSchema, draftSchema, DRAFT_MAX_OUTPUT_TOKENS } from "@/lib/prompts/draft.v2";
import { buildVoiceContext } from "@/lib/prompts/voice-context.v1";
import { BRIEF, VOICE_SET } from "./fixtures";
import { CappedProvider, EVAL_CAP_USD, evalEnabled } from "./budget";

const MODEL = process.env.LLM_MODEL_DRAFT || "claude-opus-5-5";

describe.skipIf(!evalEnabled())(`generation eval (real AI calls, cap $${EVAL_CAP_USD})`, () => {
  it("writes concepts and a draft that follow the rules", async () => {
    const ai = new CappedProvider();
    const voiceContext = buildVoiceContext({ ...VOICE_SET, profileVersion: 1 });
    const concepts = await ai.generate({
      task: "concepts",
      model: MODEL,
      ...buildConceptPrompt({
        founder: VOICE_SET.founder,
        founderId: "f1",
        monthLabel: "November 2026",
        brief: BRIEF,
        voiceContext,
        findings: [],
        existing: [],
        otherFounders: [],
        count: 3,
      }),
      untrustedContext: [],
      schema: conceptBatchSchema,
      maxOutputTokens: CONCEPTS_MAX_OUTPUT_TOKENS,
      effort: "medium",
    });
    console.log("Concepts:", JSON.stringify(concepts.data.concepts, null, 2));
    expect(concepts.data.concepts.length).toBeGreaterThan(0);

    const concept = concepts.data.concepts[0];
    const draft = await ai.generate({
      task: "draft",
      model: MODEL,
      ...buildDraftPrompt({
        founder: VOICE_SET.founder,
        founderId: "f1",
        monthLabel: "November 2026",
        brief: BRIEF,
        concept: {
          title: concept.title,
          coreArgument: concept.core_argument,
          hook: concept.hook,
          format: concept.format,
          audience: concept.audience,
          whyThisFounder: concept.why_this_founder,
          evidenceRequirements: concept.evidence_requirements,
          needsPersonalStory: concept.needs_personal_story,
        },
        voiceContext,
        findings: [],
        revising: null,
      }),
      untrustedContext: [],
      schema: draftSchema,
      maxOutputTokens: DRAFT_MAX_OUTPUT_TOKENS,
      effort: "medium",
    });
    const body = draft.data.post_body;
    const review = reviewDraft({
      body,
      claims: draft.data.claims,
      modelFlags: draft.data.flags,
      approvedFacts: BRIEF.approvedFacts,
      avoidPhrases: VOICE_SET.profile.avoidPhrases,
      styleRules: VOICE_SET.profile.styleRules,
    });
    console.log(`\nDraft (${body.length} characters):\n\n${body}\n`);
    console.log(
      "Flags:",
      review.flags.map((f) => `${f.severity} ${f.kind}: ${f.message}`),
    );
    console.log(`Total cost: $${ai.spent.toFixed(4)} (cap $${EVAL_CAP_USD})`);

    expect(draftRecordSchema.safeParse(draft.data).success).toBe(true);
    expect(metadataLeak(body)).toBeNull();
    if (concept.needs_personal_story) expect(findPlaceholders(body).length).toBeGreaterThan(0);
  });
});
