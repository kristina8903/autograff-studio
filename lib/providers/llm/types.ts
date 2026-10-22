// The AI provider boundary (docs/ARCHITECTURE.md §4.4). Code outside
// lib/providers/llm never imports a vendor SDK.

import type { z } from "zod";
import type { FailureKind } from "@/lib/domain/retry";
import type { TokenUsage } from "@/lib/domain/pricing";

export type LlmTask = "concepts" | "draft" | "fingerprint" | "repetition_judge" | "feedback";

/** Text given to the model. Trusted: brief, voice, examples. Untrusted: web or Slack text (Phase 5+). */
export type ContextBlock = { label: string; text: string };

export type StructuredRequest<T> = {
  task: LlmTask;
  model: string;
  /** Trusted instructions only. */
  system: string;
  trustedContext: ContextBlock[];
  untrustedContext: ContextBlock[];
  instruction: string;
  schema: z.ZodType<T>;
  maxOutputTokens: number;
  effort: "low" | "medium" | "high";
};

export type Usage = TokenUsage & { costUsd: number };

export type StructuredResult<T> = { data: T; usage: Usage; servedModel: string };

export class LlmError extends Error {
  constructor(
    readonly kind: FailureKind,
    readonly retryAfterSeconds: number | null = null,
    /** Tokens already billed for this attempt (e.g. an answer that failed validation). */
    readonly usage: Usage | null = null,
  ) {
    super(kind);
    this.name = "LlmError";
  }
}

export interface LlmProvider {
  readonly name: "anthropic" | "fake";
  generateStructured<T>(request: StructuredRequest<T>): Promise<StructuredResult<T>>;
}

/** The full prompt as one string, for estimating its size. */
export function promptText(
  request: Pick<StructuredRequest<unknown>, "system" | "trustedContext" | "untrustedContext" | "instruction">,
) {
  return [
    request.system,
    ...request.trustedContext.map((b) => `${b.label}\n${b.text}`),
    ...request.untrustedContext.map((b) => `${b.label}\n${b.text}`),
    request.instruction,
  ].join("\n\n");
}
