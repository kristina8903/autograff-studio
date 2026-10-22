// npm run eval:voice — for each held-out example, writes a draft on its topic
// from the profile and the retrieved examples, then asks a judge model how
// close the draft's voice is to the held-out post (style, not content).
// Hard cap: $1.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { buildDraftPrompt, draftSchema, DRAFT_MAX_OUTPUT_TOKENS } from "@/lib/prompts/draft.v1";
import { buildVoiceContext } from "@/lib/prompts/voice-context.v1";
import { BRIEF, VOICE_SET, type VoiceSet } from "./fixtures";
import { CappedProvider, EVAL_CAP_USD, evalEnabled } from "./budget";

const DRAFT_MODEL = process.env.LLM_MODEL_DRAFT || "claude-opus-5-5";
const JUDGE_MODEL = process.env.LLM_MODEL_EXTRACT || "claude-sonnet-5-5";

const judgeSchema = z.object({ score: z.number().int(), reasons: z.string() });

function voiceSet(): VoiceSet {
  return process.env.EVAL_VOICE_FILE
    ? (JSON.parse(readFileSync(process.env.EVAL_VOICE_FILE, "utf8")) as VoiceSet)
    : VOICE_SET;
}

describe.skipIf(!evalEnabled())(`voice eval (real AI calls, cap $${EVAL_CAP_USD})`, () => {
  it("scores how close drafts sound to the founder's held-out posts", async () => {
    const set = voiceSet();
    const ai = new CappedProvider();
    const voiceContext = buildVoiceContext({ ...set, profileVersion: 1 });
    const scores: number[] = [];
    for (const held of set.heldOut) {
      // The held-out post is never shown to the writer, only its topic.
      const draft = await ai.generate({
        task: "draft",
        model: DRAFT_MODEL,
        ...buildDraftPrompt({
          founder: set.founder,
          founderId: "f1",
          monthLabel: "November 2026",
          brief: BRIEF,
          concept: {
            title: held.topic,
            coreArgument: held.topic,
            hook: "",
            format: "opinion",
            audience: "",
            whyThisFounder: "",
            evidenceRequirements: [],
            needsPersonalStory: false,
          },
          voiceContext,
          revising: null,
        }),
        untrustedContext: [],
        schema: draftSchema,
        maxOutputTokens: DRAFT_MAX_OUTPUT_TOKENS,
        effort: "medium",
      });
      const judged = await ai.generate({
        task: "repetition_judge",
        model: JUDGE_MODEL,
        system:
          "You compare writing voice: sentence length and rhythm, paragraph shape, word choice, tone and point of view. Ignore what the posts are about.",
        trustedContext: [
          { label: "Post A (the founder's own)", text: held.body },
          { label: "Post B (a draft)", text: draft.data.post_body },
        ],
        untrustedContext: [],
        instruction:
          "Score 1 to 5 how much Post B sounds like the person who wrote Post A (5 = indistinguishable). Give two or three short reasons.",
        schema: judgeSchema,
        maxOutputTokens: 2_000,
        effort: "low",
      });
      scores.push(judged.data.score);
      console.log(`\n${held.id}: ${judged.data.score}/5. ${judged.data.reasons}\nDraft:\n${draft.data.post_body}\n`);
    }
    const average = scores.reduce((a, b) => a + b, 0) / scores.length;
    console.log(
      `Average voice match: ${average.toFixed(2)}/5 over ${scores.length} post(s). Cost $${ai.spent.toFixed(4)}.`,
    );
    expect(scores.every((s) => s >= 1 && s <= 5)).toBe(true);
  });
});
