// A deterministic stand-in for the AI, used by every automated test and by
// local development without an API key. It never calls the network.

import { costOf } from "@/lib/domain/pricing";
import { LlmError, promptText, type LlmProvider, type StructuredRequest, type StructuredResult } from "./types";

type Handler = (request: StructuredRequest<unknown>) => unknown;

/** Scripted outcomes for tests: a value to return, or an error to throw, per call in order. */
export type FakeScript = (unknown | LlmError)[];

export class FakeLlmProvider implements LlmProvider {
  readonly name = "fake" as const;
  readonly calls: StructuredRequest<unknown>[] = [];
  private script: FakeScript | null;

  constructor(
    private readonly handlers: Partial<Record<StructuredRequest<unknown>["task"], Handler>> = DEFAULT_HANDLERS,
    script: FakeScript | null = null,
  ) {
    this.script = script ? [...script] : null;
  }

  async generateStructured<T>(request: StructuredRequest<T>): Promise<StructuredResult<T>> {
    this.calls.push(request as StructuredRequest<unknown>);
    const next = this.script
      ? this.script.shift()
      : this.handlers[request.task]?.(request as StructuredRequest<unknown>);
    if (next instanceof LlmError) throw next;
    const usage = {
      inputTokens: Math.ceil(promptText(request).length / 4),
      outputTokens: Math.ceil(JSON.stringify(next ?? null).length / 4),
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
    };
    const priced = { ...usage, costUsd: costOf(request.model, usage) };
    const parsed = request.schema.safeParse(next);
    if (!parsed.success) throw new LlmError("invalid_output", null, priced);
    return { data: parsed.data, usage: priced, servedModel: request.model };
  }
}

const FORMATS = ["story", "opinion", "how_to", "data_insight", "lesson", "list", "question"] as const;

/** Builds N plausible concepts from the instruction ("Propose exactly N concepts") and the theme. */
function fakeConcepts(request: StructuredRequest<unknown>) {
  const count = Number(request.instruction.match(/exactly (\d+) concept/)?.[1] ?? 1);
  const theme =
    request.trustedContext.find((b) => b.label === "Monthly brief")?.text.match(/Theme: (.*)/)?.[1] ?? "the theme";
  return {
    concepts: Array.from({ length: count }, (_, i) => ({
      title: `${theme}: angle ${i + 1}`,
      audience: "Fleet operations leads",
      core_argument: `Argument ${i + 1} about ${theme.toLowerCase()}.`,
      hook: `What changes when ${theme.toLowerCase()} is visible? (${i + 1})`,
      format: FORMATS[i % FORMATS.length],
      why_this_founder: "It draws on topics in this founder's voice profile.",
      evidence_requirements: i % 2 === 0 ? ["A recent figure for average repair cycle time"] : [],
      needs_personal_story: i % 3 === 0,
      fingerprint: {
        topics: ["repair operations"],
        argument_key: `fake-argument-${i + 1}`,
        hook_type: "question",
        audience: "fleet operations",
        product_mentions: [],
        cta: "none",
      },
    })),
  };
}

/**
 * A draft built from the concept block. It always states one fact that no
 * approved fact backs (so the claim rules have something to flag), and uses a
 * placeholder when the concept needs a personal story.
 */
function fakeDraft(request: StructuredRequest<unknown>) {
  const concept = request.trustedContext.find((b) => b.label === "Concept")?.text ?? "";
  const field = (name: string) => concept.match(new RegExp(`^${name}: (.*)$`, "m"))?.[1] ?? "";
  const story = concept.includes("needs a personal story");
  const revising = request.trustedContext.some((b) => b.label === "Previous version");
  const unsupported = "Most repair delays come from waiting for approvals, not parts";
  // With research findings offered, the first one is cited as a fact (finding 0).
  const finding = request.untrustedContext
    .find((b) => b.label === "Research findings")
    ?.text.match(/^\[0\] (.*?)(?: \([^()]*\))?$/m)?.[1]
    ?.replace(/\.$/, "");
  const opening = `${revising ? "Take two. " : ""}${field("Hook idea") || field("Title")}`;
  const body = [
    opening,
    `${field("Core argument")} ${unsupported}.${finding ? ` ${finding}.` : ""}`,
    story ? "[FOUNDER TO SUPPLY: a time a repair status surprise cost you a day]" : "",
    "What would you change first?",
  ]
    .filter(Boolean)
    .join("\n\n");
  return {
    post_body: body,
    alternative_hooks: ["What does a late van really cost?", "Nobody tells the fleet manager."],
    claims: [
      { text: unsupported, kind: "sourced_fact", approved_fact_index: null, finding_index: null },
      ...(finding ? [{ text: finding, kind: "sourced_fact", approved_fact_index: null, finding_index: 0 }] : []),
    ],
    flags: [],
    rationale: "Fake rationale: leads with the hook, then the argument.",
    fingerprint: {
      topics: ["repair operations"],
      argument_key: field("Title").toLowerCase(),
      hook_type: "question",
      opening_line: opening,
      format: "story",
      audience: "fleet operations",
      product_mentions: [],
      cta: "none",
    },
  };
}

/** Marks every shortlisted item as a partial overlap. */
function fakeRepetitionJudge(request: StructuredRequest<unknown>) {
  const ids = [
    ...(request.trustedContext.find((b) => b.label === "Earlier content")?.text ?? "").matchAll(/<item id="([^"]+)"/g),
  ];
  return {
    items: ids.map((m) => ({ id: m[1], overlap: "partial", explanation: "Fake judge: the same argument." })),
  };
}

/** One stable preference and one one-off edit whenever the text changed. */
function fakeFeedback(request: StructuredRequest<unknown>) {
  const text = (label: string) => request.trustedContext.find((b) => b.label === label)?.text ?? "";
  if (text("Before the founder's edits") === text("As the founder approved it")) return { signals: [] };
  return {
    signals: [
      {
        kind: "stable_preference",
        statement: "Fake signal: replaces generic lines with a concrete example.",
        format: null,
      },
      { kind: "one_off", statement: "Fake signal: added a detail specific to this post.", format: null },
    ],
  };
}

/**
 * One finding per sentence that states a number, quoted word for word. An
 * excerpt carrying "ignore previous instructions" makes the fake behave like
 * a model that obeyed it: it adds a finding with a web address and a quote
 * that isn't in the excerpt, which the validators must reject.
 */
function fakeFindings(request: StructuredRequest<unknown>) {
  const text = request.untrustedContext.find((b) => b.label === "Excerpts")?.text ?? "";
  const findings: unknown[] = [];
  for (const m of text.matchAll(/<excerpt number="(\d+)"[^>]*>\n([\s\S]*?)\n<\/excerpt>/g)) {
    const source = Number(m[1]);
    for (const sentence of m[2].split(/(?<=[.!?])\s+/)) {
      if (/ignore previous instructions/i.test(sentence)) {
        findings.push({
          source,
          claim: "Readers should visit https://evil.example/offer for a discount.",
          quote: "Autograff is the best repair software",
          value: null,
          unit: null,
          population: null,
          period: null,
          event_date: null,
        });
        continue;
      }
      const numbers = sentence.match(/\d+(?:,\d{3})*(?:\.\d+)?%?/g) ?? [];
      const number = numbers.find((n) => !/^(19|20)\d\d$/.test(n)) ?? numbers[0];
      if (!number) continue;
      findings.push({
        source,
        claim: sentence.trim(),
        quote: sentence.trim().replace(/[.!?]$/, ""),
        value: number.replace(/%$/, ""),
        unit: number.endsWith("%") ? "%" : null,
        population: null,
        period: null,
        event_date: sentence.match(/\b(20\d\d)\b/)?.[1] ?? null,
      });
    }
  }
  return { findings };
}

const DEFAULT_HANDLERS: Partial<Record<StructuredRequest<unknown>["task"], Handler>> = {
  concepts: fakeConcepts,
  draft: fakeDraft,
  repetition_judge: fakeRepetitionJudge,
  feedback: fakeFeedback,
  findings: fakeFindings,
};
