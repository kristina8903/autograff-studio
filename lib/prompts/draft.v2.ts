// Draft prompt (PRODUCT_SPEC §5.3, §5.6, §5.7). Versioned: behavior changes go
// in a new file, and each run records the version it used.
// v2 (Phase 5): claims can cite a human-verified research finding.

import { z } from "zod";
import type { BriefSnapshot } from "@/lib/domain/briefs";
import { FORMAT_VALUES, formatLabel } from "@/lib/domain/formats";
import type { ContextBlock } from "@/lib/providers/llm/types";
import { CTA_LEVELS, HOOK_TYPES } from "./concepts.v1";

export const DRAFT_TEMPLATE = "draft";
export const DRAFT_VERSION = 2;
export const DRAFT_MAX_OUTPUT_TOKENS = 16_000;

export const draftSchema = z.object({
  post_body: z.string(),
  alternative_hooks: z.array(z.string()),
  claims: z.array(
    z.object({
      text: z.string(),
      kind: z.enum(["sourced_fact", "opinion", "interpretation", "founder_experience"]),
      approved_fact_index: z.number().int().nullable(),
      finding_index: z.number().int().nullable(),
    }),
  ),
  flags: z.array(
    z.object({
      kind: z.enum([
        "competitor_claim",
        "product_claim",
        "sensitive_content",
        "weak_evidence",
        "needs_personal_context",
      ]),
      message: z.string(),
      quote: z.string(),
    }),
  ),
  rationale: z.string(),
  fingerprint: z.object({
    topics: z.array(z.string()),
    argument_key: z.string(),
    hook_type: z.enum(HOOK_TYPES),
    opening_line: z.string(),
    format: z.enum(FORMAT_VALUES),
    audience: z.string(),
    product_mentions: z.array(z.string()),
    cta: z.enum(CTA_LEVELS),
  }),
});
export type GeneratedDraft = z.infer<typeof draftSchema>;

/** What the database and the review rules accept. */
export const draftRecordSchema = draftSchema.extend({
  post_body: z.string().trim().min(1).max(6000),
  alternative_hooks: z.array(z.string().trim().min(1).max(500)).max(6),
  rationale: z.string().trim().max(4000),
  claims: z
    .array(
      z.object({
        text: z.string().trim().min(1).max(1000),
        kind: z.enum(["sourced_fact", "opinion", "interpretation", "founder_experience"]),
        approved_fact_index: z.number().int().nullable(),
        finding_index: z.number().int().nullable(),
      }),
    )
    .max(40),
});

export type DraftPromptInput = {
  founder: { displayName: string; roleTitle: string };
  founderId: string;
  monthLabel: string;
  brief: BriefSnapshot & { versionNo: number };
  concept: {
    title: string;
    coreArgument: string;
    hook: string;
    format: string;
    audience: string;
    whyThisFounder: string;
    evidenceRequirements: string[];
    needsPersonalStory: boolean;
  };
  voiceContext: string;
  /** Human-verified findings of accepted sources (Phase 5), cited by number. */
  findings: { claim: string; source: string; date: string }[];
  /** For a regeneration: the version being replaced and the admin's guidance. */
  revising: { body: string; guidance: string } | null;
};

const SYSTEM = `You write LinkedIn posts for a founder of Autograff, a company that builds software for vehicle repair and fleet maintenance. You write one post from one concept, in the founder's voice.

Hard rules:
- post_body is the LinkedIn post text only. Never put a rationale, sources, claims, flags or notes in it.
- Never invent first-person experiences, anecdotes, customer stories, opinions attributed to anyone, quotes, statistics, studies, names or URLs.
- Where the post needs a story or detail only the founder knows, write exactly [FOUNDER TO SUPPLY: what is needed] in post_body, e.g. [FOUNDER TO SUPPLY: a time a repair status surprise cost you a day]. The founder fills it in later.
- State as fact only the approved facts listed in the brief and the research findings provided. List every factual claim in claims: a claim backed by an approved fact gets its number in approved_fact_index; a claim backed by a research finding gets its number in finding_index; any other factual claim gets null in both and will be flagged for review, so prefer stating it as the founder's opinion instead. Keep a finding's numbers exactly as given. Never name a source or add a link in post_body unless the brief's approved facts include it. List first-person experience as founder_experience.
- In flags, point out any competitor named or compared, claims about Autograff's product, sensitive content, and evidence that is thin. Quote the exact words from post_body.
- Follow the founder's voice profile, style rules and phrases to avoid. Match the rhythm of their examples without copying their facts or stories.
- Respect the brief's topics to avoid and its calls to action. Posts do not have to mention Autograff.
- US English. Usually 120 to 250 words, never over 3,000 characters. Write real paragraphs; avoid a string of one-line paragraphs. No hashtag lists.
- alternative_hooks: 2 to 4 different opening lines for the same post.
- rationale (internal, never shown in the post): why this angle and structure, in two or three sentences.
- fingerprint.argument_key: a short stable phrase naming the core argument; fingerprint.opening_line: the post's first line.`;

function briefText(input: DraftPromptInput): string {
  const { content, approvedFacts } = input.brief;
  const lines = [`Month: ${input.monthLabel} (brief version ${input.brief.versionNo})`, `Theme: ${content.theme}`];
  const emphasis = input.brief.founderEmphasis[input.founderId];
  lines.push(`This founder's emphasis: ${emphasis || "(none given)"}`);
  if (content.topicsToAvoid.length) lines.push("Topics to avoid:", ...content.topicsToAvoid.map((t) => `- ${t}`));
  if (content.callsToAction.length) lines.push("Calls to action:", ...content.callsToAction.map((t) => `- ${t}`));
  lines.push(
    "Approved facts (the only things you may state as fact; cite by number):",
    ...(approvedFacts.length ? approvedFacts.map((f, i) => `[${i}] ${f}`) : ["(none this month)"]),
  );
  return lines.join("\n");
}

function conceptText(c: DraftPromptInput["concept"]): string {
  return [
    `Title: ${c.title}`,
    `Core argument: ${c.coreArgument}`,
    c.hook ? `Hook idea: ${c.hook}` : "",
    `Format: ${formatLabel(c.format)}`,
    c.audience ? `Audience: ${c.audience}` : "",
    c.whyThisFounder ? `Why this founder: ${c.whyThisFounder}` : "",
    c.evidenceRequirements.length
      ? `Evidence the post needs (if not in the approved facts, do not invent it; use a placeholder or opinion):\n${c.evidenceRequirements.map((e) => `- ${e}`).join("\n")}`
      : "",
    c.needsPersonalStory ? "This concept needs a personal story from the founder: use a placeholder for it." : "",
  ]
    .filter(Boolean)
    .join("\n");
}

export function findingsText(findings: DraftPromptInput["findings"]): string {
  return findings.map((f, i) => `[${i}] ${f.claim} (${f.source}, ${f.date})`).join("\n");
}

export function buildDraftPrompt(input: DraftPromptInput): {
  system: string;
  trustedContext: ContextBlock[];
  untrustedContext: ContextBlock[];
  instruction: string;
} {
  const context: ContextBlock[] = [
    { label: "Monthly brief", text: briefText(input) },
    { label: "Concept", text: conceptText(input.concept) },
    { label: "Founder voice", text: input.voiceContext },
  ];
  if (input.revising) context.push({ label: "Previous version", text: input.revising.body });
  // Verified by a person, but they come from web pages: passed as outside data.
  const untrusted: ContextBlock[] = input.findings.length
    ? [{ label: "Research findings", text: findingsText(input.findings) }]
    : [];
  const instruction = input.revising
    ? `Write a new version of this post for ${input.founder.displayName}. Do not copy the previous version.${
        input.revising.guidance ? ` The admin's guidance: ${input.revising.guidance}` : ""
      }`
    : `Write the post for ${input.founder.displayName} (${input.founder.roleTitle}) from this concept.`;
  return { system: SYSTEM, trustedContext: context, untrustedContext: untrusted, instruction };
}
