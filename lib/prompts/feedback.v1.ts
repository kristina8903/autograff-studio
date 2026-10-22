// Proposes feedback signals from a founder's edits (PRODUCT_SPEC §5.5).
// A proposal only: the admin accepts or rejects each one (Phase 3 screens).

import { z } from "zod";
import { FORMAT_VALUES, type PostFormat } from "@/lib/domain/formats";
import type { ContextBlock } from "@/lib/providers/llm/types";

export const FEEDBACK_MAX_OUTPUT_TOKENS = 2_000;
export const FEEDBACK_MAX_SIGNALS = 5;

export const feedbackSchema = z.object({
  signals: z.array(
    z.object({
      kind: z.enum(["stable_preference", "format_preference", "one_off"]),
      statement: z.string(),
      format: z.enum(FORMAT_VALUES).nullable(),
    }),
  ),
});
export type FeedbackSignal = z.infer<typeof feedbackSchema>["signals"][number];

const SYSTEM = `You compare a LinkedIn post draft before and after its author, a company founder, edited it, and describe what the edits say about how they write. Classify each distinct edit pattern as one of:
- "stable_preference": a habit that would apply to any of their posts ("Cuts the opening question and starts with the claim").
- "format_preference": a habit for one post format only; give the format.
- "one_off": a change specific to this post (a corrected detail, a different example).
Write each statement in one sentence, in the third person, about the writing, not the topic. Only describe edits you can see in the text. Do not guess at reasons. Typo fixes and whitespace are not signals. Return no signals if the edits are trivial.`;

export function buildFeedbackPrompt(input: { before: string; after: string; format: PostFormat | null }) {
  const context: ContextBlock[] = [
    { label: "Before the founder's edits", text: input.before },
    { label: "As the founder approved it", text: input.after },
  ];
  return {
    system: SYSTEM,
    trustedContext: context,
    instruction: `The post's format is ${input.format ?? "not recorded"}. Propose at most ${FEEDBACK_MAX_SIGNALS} signals.`,
  };
}

/** Keeps well-formed signals only: a statement, a format for format preferences, at most the maximum. */
export function cleanSignals(signals: FeedbackSignal[]): FeedbackSignal[] {
  return signals
    .map((s) => ({ ...s, statement: s.statement.trim().slice(0, 1000) }))
    .filter((s) => s.statement.length > 0 && (s.kind !== "format_preference" || s.format !== null))
    .slice(0, FEEDBACK_MAX_SIGNALS);
}
