// Semantic repetition check on the pre-filter's shortlist (PRODUCT_SPEC §6, step 2).

import { z } from "zod";
import type { ContextBlock } from "@/lib/providers/llm/types";

export const REPETITION_JUDGE_MAX_OUTPUT_TOKENS = 4_000;

export const repetitionJudgeSchema = z.object({
  items: z.array(
    z.object({
      id: z.string(),
      overlap: z.enum(["none", "partial", "duplicate"]),
      explanation: z.string(),
    }),
  ),
});
export type RepetitionVerdict = z.infer<typeof repetitionJudgeSchema>["items"][number];

export type RepetitionCandidate = {
  compared_type: "draft" | "concept" | "published_post";
  compared_id: string;
  excerpt: string;
  similarity: number;
  same_argument: boolean;
};

const SYSTEM = `You check whether a new LinkedIn post draft repeats earlier content from the same company. For each earlier item, say whether the draft makes the same argument or uses the same hook: "duplicate" (same argument, same angle), "partial" (overlapping argument or hook, different enough to keep with care) or "none". Explain in one sentence, naming what overlaps. Judge the argument, not shared vocabulary: posts about the same industry share words.`;

export function buildRepetitionJudgePrompt(draftBody: string, candidates: RepetitionCandidate[]) {
  const context: ContextBlock[] = [
    { label: "New draft", text: draftBody },
    {
      label: "Earlier content",
      text: candidates
        .map((c) => `<item id="${c.compared_id}" type="${c.compared_type}">\n${c.excerpt}\n</item>`)
        .join("\n"),
    },
  ];
  return {
    system: SYSTEM,
    trustedContext: context,
    instruction: `Judge each of the ${candidates.length} earlier items against the new draft. Use the item ids given.`,
  };
}
