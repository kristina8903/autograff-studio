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

const DEFAULT_HANDLERS: Partial<Record<StructuredRequest<unknown>["task"], Handler>> = { concepts: fakeConcepts };
