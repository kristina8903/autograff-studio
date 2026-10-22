// Concept batch prompt (PRODUCT_SPEC §5.2). Versioned: behavior changes go in
// a new concepts.v2.ts, and each run records the version it used.

import { z } from "zod";
import { LIST_FIELDS as BRIEF_LIST_FIELDS, type BriefSnapshot } from "@/lib/domain/briefs";
import { FORMAT_VALUES, POST_FORMATS } from "@/lib/domain/formats";
import type { ContextBlock } from "@/lib/providers/llm/types";

export const CONCEPTS_TEMPLATE = "concepts";
export const CONCEPTS_VERSION = 1;
export const CONCEPTS_MAX_OUTPUT_TOKENS = 16_000;
export const MAX_CONCEPTS_PER_RUN = 10;

export const HOOK_TYPES = ["question", "statement", "story", "statistic", "contrarian", "list"] as const;
export const CTA_LEVELS = ["none", "soft", "direct"] as const;

// The shape asked of the model. Lengths are checked after the answer arrives
// (conceptRecordSchema), not sent as schema constraints.
export const conceptSchema = z.object({
  title: z.string(),
  audience: z.string(),
  core_argument: z.string(),
  hook: z.string(),
  format: z.enum(FORMAT_VALUES),
  why_this_founder: z.string(),
  evidence_requirements: z.array(z.string()),
  needs_personal_story: z.boolean(),
  fingerprint: z.object({
    topics: z.array(z.string()),
    argument_key: z.string(),
    hook_type: z.enum(HOOK_TYPES),
    audience: z.string(),
    product_mentions: z.array(z.string()),
    cta: z.enum(CTA_LEVELS),
  }),
});
export const conceptBatchSchema = z.object({ concepts: z.array(conceptSchema) });
export type GeneratedConcept = z.infer<typeof conceptSchema>;

/** What the database accepts (matches the concepts table's CHECKs). */
export const conceptRecordSchema = conceptSchema.extend({
  title: z.string().trim().min(1).max(200),
  audience: z.string().trim().max(300),
  core_argument: z.string().trim().min(1).max(1000),
  hook: z.string().trim().max(500),
  why_this_founder: z.string().trim().max(1000),
  evidence_requirements: z.array(z.string().trim().min(1).max(300)).max(10),
});

export type ConceptPromptInput = {
  founder: { displayName: string; roleTitle: string };
  monthLabel: string;
  brief: BriefSnapshot & { versionNo: number };
  founderId: string;
  /** buildVoiceContext() output for this founder. */
  voiceContext: string;
  existing: { title: string; coreArgument: string; status: string }[];
  otherFounders: { roleTitle: string; title: string }[];
  count: number;
  /** Set when regenerating one concept. */
  replacing?: { title: string; coreArgument: string; guidance: string } | null;
};

const SYSTEM = `You plan LinkedIn posts for a founder of Autograff, a company that builds software for vehicle repair and fleet maintenance. You propose concepts: the angle for one post each, never the post itself.

Rules:
- Ground every concept in the monthly brief and in this founder's emphasis for the month.
- Write first-person angles only on the founder's topics of real experience, listed in their voice profile.
- Never invent facts. No statistics, quotes, customer stories, studies, names or URLs. If a concept needs a figure, write what is needed in evidence_requirements (e.g. "A 2026 figure for average repair cycle time"). If it needs a personal story from the founder, set needs_personal_story to true.
- Respect the brief's topics to avoid and themes not to repeat.
- Do not repeat the argument or hook of any existing concept listed. Vary formats and hook types across the batch.
- Posts do not have to mention Autograff. Keep sales language to what the brief's calls to action allow, and say so in fingerprint.cta.
- fingerprint.argument_key is a short, stable phrase naming the core argument, used to detect repeats.
- US English. Plain, specific wording; no hype.`;

function briefText(input: ConceptPromptInput): string {
  const { content, approvedFacts } = input.brief;
  const lines = [`Month: ${input.monthLabel} (brief version ${input.brief.versionNo})`, `Theme: ${content.theme}`];
  for (const [key, label] of BRIEF_LIST_FIELDS)
    if (content[key].length) lines.push(`${label}:`, ...content[key].map((v) => `- ${v}`));
  const emphasis = input.brief.founderEmphasis[input.founderId];
  lines.push(`This founder's emphasis: ${emphasis || "(none given)"}`);
  if (approvedFacts.length)
    lines.push("Approved facts (may be stated as fact):", ...approvedFacts.map((f) => `- ${f}`));
  return lines.join("\n");
}

export function buildConceptPrompt(input: ConceptPromptInput): {
  system: string;
  trustedContext: ContextBlock[];
  instruction: string;
} {
  const existing = input.existing.length
    ? input.existing.map((c) => `- [${c.status}] ${c.title}: ${c.coreArgument}`).join("\n")
    : "(none yet)";
  const others = input.otherFounders.length
    ? input.otherFounders.map((c) => `- ${c.roleTitle}: ${c.title}`).join("\n")
    : "(none yet)";
  const formats = POST_FORMATS.map(([value, label]) => `${value} (${label})`).join(", ");
  const instruction = input.replacing
    ? `Propose exactly 1 concept for ${input.founder.displayName} to replace "${input.replacing.title}" (${input.replacing.coreArgument}). Take a clearly different angle.${
        input.replacing.guidance ? ` The admin's guidance: ${input.replacing.guidance}` : ""
      } Formats: ${formats}.`
    : `Propose exactly ${input.count} concepts for ${input.founder.displayName} (${input.founder.roleTitle}) for ${input.monthLabel}. Formats: ${formats}.`;
  return {
    system: SYSTEM,
    trustedContext: [
      { label: "Monthly brief", text: briefText(input) },
      { label: "Founder voice", text: input.voiceContext },
      { label: "This founder's existing concepts this month", text: existing },
      { label: "Other founders' concepts this month (avoid overlap)", text: others },
    ],
    instruction,
  };
}
