import "server-only";
// Processes generation runs (docs/ARCHITECTURE.md §4.3). Storage is behind
// RunStore so the retry and failure rules are unit-tested with the fake
// provider; the database implementation is lib/server/admin/generation.ts.

import {
  metadataLeak,
  reviewDraft,
  type ClaimRecord,
  type FlagInput,
  type ModelFlag,
  type UsableFinding,
} from "@/lib/domain/draft-review";
import type { PostFormat } from "@/lib/domain/formats";
import { FAILURE_MESSAGES, retryDelaySeconds, type FailureKind } from "@/lib/domain/retry";
import {
  CONCEPTS_MAX_OUTPUT_TOKENS,
  buildConceptPrompt,
  conceptBatchSchema,
  conceptRecordSchema,
  type ConceptPromptInput,
  type GeneratedConcept,
} from "@/lib/prompts/concepts.v2";
import {
  DRAFT_MAX_OUTPUT_TOKENS,
  buildDraftPrompt,
  draftRecordSchema,
  draftSchema,
  type DraftPromptInput,
} from "@/lib/prompts/draft.v2";
import {
  FEEDBACK_MAX_OUTPUT_TOKENS,
  buildFeedbackPrompt,
  cleanSignals,
  feedbackSchema,
  type FeedbackSignal,
} from "@/lib/prompts/feedback.v1";
import {
  REPETITION_JUDGE_MAX_OUTPUT_TOKENS,
  buildRepetitionJudgePrompt,
  repetitionJudgeSchema,
  type RepetitionCandidate,
} from "@/lib/prompts/repetition-judge.v1";
import {
  FINDINGS_MAX_OUTPUT_TOKENS,
  MAX_FINDINGS_PER_RUN,
  buildFindingsPrompt,
  findingsSchema,
} from "@/lib/prompts/findings.v1";
import { LlmError, type LlmProvider, type Usage } from "@/lib/providers/llm/types";
import type { ResearchProvider } from "@/lib/providers/research/types";
import {
  MAX_SEARCHES_PER_RUN,
  canonicalUrl,
  checkFinding,
  dateLabel,
  domainAllowed,
  hostOf,
  parseLooseDate,
  type FindingRecord,
} from "@/lib/domain/research";

export type ClaimedRun = {
  id: string;
  kind: string;
  model: string;
  attempt: number;
  params: Record<string, unknown>;
};

export type DraftRunInput = {
  prompt: DraftPromptInput;
  review: { approvedFacts: string[]; avoidPhrases: string[]; styleRules: string[]; findings: UsableFinding[] };
  /** The model for the repetition judge (the cheaper "extract" model). */
  judgeModel: string;
};

export type DraftPayload = {
  body: string;
  alternative_hooks: string[];
  rationale: string;
  fingerprint: Record<string, unknown>;
  claims: ClaimRecord[];
  flags: FlagInput[];
  checks: {
    compared_type: string;
    compared_id: string;
    method: "trigram" | "fingerprint" | "llm";
    score: number | null;
    explanation: string;
  }[];
};

/** A founder's edits to classify: the text before their first edit and the text they approved. */
export type FeedbackRunInput = { before: string; after: string; format: PostFormat | null };

export type ResearchRunInput = {
  query: string;
  allowedDomains: string[];
  blockedDomains: string[];
};

export type ResearchPayload = {
  sources: {
    url: string;
    canonical_url: string;
    title: string;
    publisher: string;
    page_age: string | null;
    published_at: string | null;
    published_at_precision: "day" | "month" | "year" | "unknown";
    excerpt: string;
    findings: FindingRecord[];
  }[];
  findings_rejected: number;
};

export interface RunStore {
  claim(runId?: string): Promise<ClaimedRun | null>;
  conceptInput(run: ClaimedRun): Promise<ConceptPromptInput>;
  completeConcepts(runId: string, servedModel: string, usage: Usage, concepts: GeneratedConcept[]): Promise<number>;
  draftInput(run: ClaimedRun): Promise<DraftRunInput>;
  repetitionCandidates(run: ClaimedRun, text: string, argumentKey: string): Promise<RepetitionCandidate[]>;
  completeDraft(runId: string, servedModel: string, usage: Usage, payload: DraftPayload): Promise<void>;
  feedbackInput(run: ClaimedRun): Promise<FeedbackRunInput>;
  researchInput(run: ClaimedRun): Promise<ResearchRunInput>;
  completeResearch(
    runId: string,
    servedModel: string,
    usage: Usage,
    searches: number,
    payload: ResearchPayload,
  ): Promise<void>;
  completeFeedback(runId: string, servedModel: string, usage: Usage, signals: FeedbackSignal[]): Promise<number>;
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

function addUsage(a: Usage, b: Usage): Usage {
  return {
    inputTokens: a.inputTokens + b.inputTokens,
    outputTokens: a.outputTokens + b.outputTokens,
    cacheReadTokens: a.cacheReadTokens + b.cacheReadTokens,
    cacheWriteTokens: a.cacheWriteTokens + b.cacheWriteTokens,
    costUsd: a.costUsd + b.costUsd,
  };
}

const COMPARED_LABEL = { draft: "a draft", concept: "a concept", published_post: "a published post" } as const;

/**
 * Repetition flags (PRODUCT_SPEC §6): the model judge on the pre-filter's
 * shortlist. If the judge fails, the text similarity alone decides. Always
 * warnings, never blocks; the admin can override them with a reason.
 */
async function repetitionReview(
  provider: LlmProvider,
  judgeModel: string,
  body: string,
  candidates: RepetitionCandidate[],
): Promise<{ flags: FlagInput[]; checks: DraftPayload["checks"]; usage: Usage | null }> {
  const checks: DraftPayload["checks"] = candidates.map((c) => ({
    compared_type: c.compared_type,
    compared_id: c.compared_id,
    method: c.same_argument ? "fingerprint" : "trigram",
    score: c.similarity,
    explanation: c.same_argument ? "Same argument key." : "",
  }));
  if (candidates.length === 0) return { flags: [], checks, usage: null };
  const repetitionFlag = (c: RepetitionCandidate, message: string): FlagInput => ({
    kind: "repetition",
    severity: "warning",
    source: "repetition",
    message: message.slice(0, 1000),
    span_start: null,
    span_end: null,
    compared_type: c.compared_type,
    compared_id: c.compared_id,
  });
  try {
    const judged = await provider.generateStructured({
      task: "repetition_judge",
      model: judgeModel,
      ...buildRepetitionJudgePrompt(body, candidates),
      untrustedContext: [],
      schema: repetitionJudgeSchema,
      maxOutputTokens: REPETITION_JUDGE_MAX_OUTPUT_TOKENS,
      effort: "low",
    });
    const flags: FlagInput[] = [];
    for (const verdict of judged.data.items) {
      const candidate = candidates.find((c) => c.compared_id === verdict.id);
      if (!candidate) continue;
      checks.push({
        compared_type: candidate.compared_type,
        compared_id: candidate.compared_id,
        method: "llm",
        score: verdict.overlap === "duplicate" ? 1 : verdict.overlap === "partial" ? 0.5 : 0,
        explanation: verdict.explanation.slice(0, 1000),
      });
      if (verdict.overlap !== "none")
        flags.push(
          repetitionFlag(
            candidate,
            `${verdict.overlap === "duplicate" ? "Repeats" : "Overlaps with"} ${COMPARED_LABEL[candidate.compared_type]}: ${verdict.explanation}`,
          ),
        );
    }
    return { flags, checks, usage: judged.usage };
  } catch (error) {
    const flags = candidates
      .filter((c) => c.same_argument || c.similarity >= 0.5)
      .map((c) =>
        repetitionFlag(
          c,
          c.same_argument
            ? `Makes the same argument as ${COMPARED_LABEL[c.compared_type]}: "${c.excerpt.slice(0, 120)}"`
            : `Text ${Math.round(c.similarity * 100)}% similar to ${COMPARED_LABEL[c.compared_type]}: "${c.excerpt.slice(0, 120)}"`,
        ),
      );
    return { flags, checks, usage: error instanceof LlmError ? error.usage : null };
  }
}

async function processDraft(store: RunStore, provider: LlmProvider, run: ClaimedRun): Promise<void> {
  const input = await store.draftInput(run);
  const result = await provider.generateStructured({
    task: "draft",
    model: run.model,
    ...buildDraftPrompt(input.prompt),
    schema: draftSchema,
    maxOutputTokens: DRAFT_MAX_OUTPUT_TOKENS,
    effort: "medium",
  });
  const parsed = draftRecordSchema.safeParse(result.data);
  // A body carrying rationale, sources or flags is rejected, never stored (PRODUCT_SPEC §5.3).
  if (!parsed.success || metadataLeak(parsed.data.post_body)) throw new LlmError("invalid_output", null, result.usage);
  const draft = parsed.data;
  const review = reviewDraft({
    body: draft.post_body,
    claims: draft.claims,
    modelFlags: draft.flags as ModelFlag[],
    ...input.review,
  });
  const candidates = await store.repetitionCandidates(run, draft.post_body, draft.fingerprint.argument_key);
  const repetition = await repetitionReview(provider, input.judgeModel, draft.post_body, candidates);
  await store.completeDraft(
    run.id,
    result.servedModel,
    repetition.usage ? addUsage(result.usage, repetition.usage) : result.usage,
    {
      body: draft.post_body,
      alternative_hooks: draft.alternative_hooks.slice(0, 4),
      rationale: draft.rationale,
      fingerprint: draft.fingerprint,
      claims: review.records,
      flags: [...review.flags, ...repetition.flags],
      checks: repetition.checks,
    },
  );
}

async function processFeedback(store: RunStore, provider: LlmProvider, run: ClaimedRun): Promise<void> {
  const input = await store.feedbackInput(run);
  const result = await provider.generateStructured({
    task: "feedback",
    model: run.model,
    ...buildFeedbackPrompt(input),
    untrustedContext: [],
    schema: feedbackSchema,
    maxOutputTokens: FEEDBACK_MAX_OUTPUT_TOKENS,
    effort: "low",
  });
  await store.completeFeedback(run.id, result.servedModel, result.usage, cleanSignals(result.data.signals));
}

/**
 * Web research (docs/INTEGRATIONS.md §3.4): search, keep only sources our
 * domain lists allow, then a tool-less extraction whose every finding is
 * checked against its excerpt. Rejected findings are counted, never stored.
 */
async function processResearch(
  store: RunStore,
  provider: LlmProvider,
  research: ResearchProvider,
  run: ClaimedRun,
  now: Date,
): Promise<void> {
  const input = await store.researchInput(run);
  const found = await research.search({
    query: input.query,
    model: run.model,
    allowedDomains: input.allowedDomains,
    blockedDomains: input.blockedDomains,
    maxSearches: MAX_SEARCHES_PER_RUN,
  });
  const lists = { allowed: input.allowedDomains, blocked: input.blockedDomains };
  const seen = new Set<string>();
  const sources = found.sources.flatMap((source) => {
    const canonical = canonicalUrl(source.url);
    if (!canonical || seen.has(canonical) || !domainAllowed(source.url, lists) || !source.excerpts.length) return [];
    seen.add(canonical);
    const published = parseLooseDate(source.pageAge, now);
    return [
      {
        url: source.url,
        canonical_url: canonical,
        title: source.title.trim().slice(0, 500),
        publisher: hostOf(source.url) ?? "",
        page_age: source.pageAge,
        published_at: published.date,
        published_at_precision: published.precision,
        excerpt: source.excerpts.join("\n"),
        findings: [] as FindingRecord[],
      },
    ];
  });
  let usage = found.usage;
  let servedModel = found.servedModel;
  let rejected = 0;
  if (sources.length) {
    let extracted;
    try {
      extracted = await provider.generateStructured({
        task: "findings",
        model: run.model,
        ...buildFindingsPrompt(
          input.query,
          sources.map((s) => ({
            title: s.title,
            publisher: s.publisher,
            dateLabel: dateLabel(s.published_at, s.published_at_precision),
            excerpt: s.excerpt,
          })),
        ),
        schema: findingsSchema,
        maxOutputTokens: FINDINGS_MAX_OUTPUT_TOKENS,
        effort: "low",
      });
    } catch (error) {
      // The searches were billed: count them with the failure.
      if (error instanceof LlmError)
        throw new LlmError(error.kind, error.retryAfterSeconds, addUsage(usage, error.usage ?? zeroUsage()));
      throw error;
    }
    usage = addUsage(usage, extracted.usage);
    servedModel = extracted.servedModel;
    for (const finding of extracted.data.findings.slice(0, MAX_FINDINGS_PER_RUN)) {
      const source = sources[finding.source];
      const check = source ? checkFinding(finding, source.excerpt, now) : null;
      if (check?.ok) source.findings.push(check.record);
      else rejected++;
    }
    rejected += Math.max(0, extracted.data.findings.length - MAX_FINDINGS_PER_RUN);
  }
  await store.completeResearch(run.id, servedModel, usage, found.searches, {
    sources,
    findings_rejected: rejected,
  });
}

function zeroUsage(): Usage {
  return { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, costUsd: 0 };
}

export async function processRun(
  store: RunStore,
  provider: LlmProvider,
  runId?: string,
  research?: ResearchProvider,
  now: Date = new Date(),
): Promise<RunOutcome | null> {
  const run = await store.claim(runId);
  if (!run) return null;
  try {
    if (run.kind === "research") {
      if (!research) throw new RunInputError("No research provider is configured.");
      await processResearch(store, provider, research, run, now);
      return { runId: run.id, status: "succeeded" };
    }
    if (run.kind === "draft" || run.kind === "draft_regen" || run.kind === "rewrite") {
      await processDraft(store, provider, run);
      return { runId: run.id, status: "succeeded" };
    }
    if (run.kind === "feedback_classification") {
      await processFeedback(store, provider, run);
      return { runId: run.id, status: "succeeded" };
    }
    if (run.kind !== "concept_batch" && run.kind !== "concept_regen")
      throw new RunInputError(`No runner for ${run.kind} yet.`);
    const input = await store.conceptInput(run);
    const prompt = buildConceptPrompt(input);
    const result = await provider.generateStructured({
      task: "concepts",
      model: run.model,
      ...prompt,
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
  research?: ResearchProvider,
): Promise<RunOutcome[]> {
  const outcomes: RunOutcome[] = [];
  while (outcomes.length < maxRuns && Date.now() < deadline) {
    const outcome = await processRun(store, provider, undefined, research);
    if (!outcome) break;
    outcomes.push(outcome);
  }
  return outcomes;
}
