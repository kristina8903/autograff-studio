import "server-only";
// Processes generation runs (docs/ARCHITECTURE.md §4.3). Storage is behind
// RunStore so the retry and failure rules are unit-tested with the fake
// provider; the database implementation is lib/server/admin/generation.ts.

import { FAILURE_MESSAGES, retryDelaySeconds, type FailureKind } from "@/lib/domain/retry";
import {
  CONCEPTS_MAX_OUTPUT_TOKENS,
  buildConceptPrompt,
  conceptBatchSchema,
  conceptRecordSchema,
  type ConceptPromptInput,
  type GeneratedConcept,
} from "@/lib/prompts/concepts.v1";
import { LlmError, type LlmProvider, type Usage } from "@/lib/providers/llm/types";

export type ClaimedRun = {
  id: string;
  kind: string;
  model: string;
  attempt: number;
  params: Record<string, unknown>;
};

export interface RunStore {
  claim(runId?: string): Promise<ClaimedRun | null>;
  conceptInput(run: ClaimedRun): Promise<ConceptPromptInput>;
  completeConcepts(runId: string, servedModel: string, usage: Usage, concepts: GeneratedConcept[]): Promise<number>;
  fail(
    runId: string,
    code: FailureKind,
    message: string,
    retryAfterSeconds: number | null,
    usage: Usage | null,
  ): Promise<"queued" | "failed">;
}

export type RunOutcome = { runId: string; status: "succeeded" | "queued" | "failed"; error?: FailureKind };

/** A failure that is not the provider's (missing brief, unknown kind): never retried. */
export class RunInputError extends Error {}

export async function processRun(store: RunStore, provider: LlmProvider, runId?: string): Promise<RunOutcome | null> {
  const run = await store.claim(runId);
  if (!run) return null;
  try {
    if (run.kind !== "concept_batch" && run.kind !== "concept_regen")
      throw new RunInputError(`No runner for ${run.kind} yet.`);
    const input = await store.conceptInput(run);
    const prompt = buildConceptPrompt(input);
    const result = await provider.generateStructured({
      task: "concepts",
      model: run.model,
      ...prompt,
      untrustedContext: [],
      schema: conceptBatchSchema,
      maxOutputTokens: CONCEPTS_MAX_OUTPUT_TOKENS,
      effort: "medium",
    });
    const wanted = input.replacing ? 1 : input.count;
    const concepts = result.data.concepts.slice(0, wanted);
    if (concepts.length === 0 || concepts.some((c) => !conceptRecordSchema.safeParse(c).success))
      throw new LlmError("invalid_output", null, result.usage);
    const records = concepts.map((c) => conceptRecordSchema.parse(c));
    await store.completeConcepts(run.id, result.servedModel, result.usage, records);
    return { runId: run.id, status: "succeeded" };
  } catch (error) {
    const kind: FailureKind = error instanceof LlmError ? error.kind : "unknown";
    const message = error instanceof RunInputError ? error.message : FAILURE_MESSAGES[kind];
    const delay = error instanceof LlmError ? retryDelaySeconds(kind, run.attempt, error.retryAfterSeconds) : null;
    const status = await store.fail(run.id, kind, message, delay, error instanceof LlmError ? error.usage : null);
    return { runId: run.id, status, error: kind };
  }
}

/** Processes due runs until none are left or the time budget is spent. */
export async function processDueRuns(
  store: RunStore,
  provider: LlmProvider,
  { maxRuns = 5, deadline = Date.now() + 240_000 } = {},
): Promise<RunOutcome[]> {
  const outcomes: RunOutcome[] = [];
  while (outcomes.length < maxRuns && Date.now() < deadline) {
    const outcome = await processRun(store, provider);
    if (!outcome) break;
    outcomes.push(outcome);
  }
  return outcomes;
}
