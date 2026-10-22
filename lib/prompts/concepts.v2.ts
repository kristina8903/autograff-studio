// Concept prompt v2 (Phase 5): v1 plus the month's human-verified research
// findings, which a concept may build on. Everything else is v1's.

import type { ContextBlock } from "@/lib/providers/llm/types";
import { buildConceptPrompt as buildV1, type ConceptPromptInput as V1Input } from "./concepts.v1";
import { findingsText, type DraftPromptInput } from "./draft.v2";

export * from "./concepts.v1";
export const CONCEPTS_VERSION = 2;

export type ConceptPromptInput = V1Input & { findings: DraftPromptInput["findings"] };

export function buildConceptPrompt(input: ConceptPromptInput): {
  system: string;
  trustedContext: ContextBlock[];
  untrustedContext: ContextBlock[];
  instruction: string;
} {
  const v1 = buildV1(input);
  if (!input.findings.length) return { ...v1, untrustedContext: [] };
  return {
    ...v1,
    // Verified by a person, but they come from web pages: passed as outside data.
    untrustedContext: [{ label: "Research findings", text: findingsText(input.findings) }],
    instruction: `${v1.instruction} Research findings verified by the admin are listed; a concept may build on them. Name a finding in evidence_requirements as "Finding [n]" when the post needs it, and keep its figures exactly.`,
  };
}
