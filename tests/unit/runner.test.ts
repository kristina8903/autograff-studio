import { describe, expect, it } from "vitest";
import { readSnapshot } from "@/lib/domain/briefs";
import type { FailureKind } from "@/lib/domain/retry";
import type { ConceptPromptInput, GeneratedConcept } from "@/lib/prompts/concepts.v1";
import { FakeLlmProvider } from "@/lib/providers/llm/fake";
import { LlmError, type Usage } from "@/lib/providers/llm/types";
import type { RepetitionCandidate } from "@/lib/prompts/repetition-judge.v1";
import type { FeedbackSignal } from "@/lib/prompts/feedback.v1";
import {
  processDueRuns,
  processRun,
  type ClaimedRun,
  type DraftPayload,
  type DraftRunInput,
  type FeedbackRunInput,
  type RunStore,
} from "@/lib/server/generation/runner";

const INPUT: ConceptPromptInput = {
  founder: { displayName: "Local CEO", roleTitle: "CEO" },
  founderId: "f1",
  monthLabel: "November 2026",
  brief: {
    ...readSnapshot({ content: { theme: "Repair delays" }, founder_emphasis: {}, approved_facts: [] }),
    versionNo: 1,
  },
  voiceContext: "voice",
  existing: [],
  otherFounders: [],
  count: 3,
};

const DRAFT_INPUT: DraftRunInput = {
  prompt: {
    founder: { displayName: "Local CEO", roleTitle: "CEO" },
    founderId: "f1",
    monthLabel: "November 2026",
    brief: INPUT.brief,
    concept: {
      title: "Status updates are a product",
      coreArgument: "Fleets pay for predictability.",
      hook: "Who tells the fleet manager?",
      format: "story",
      audience: "Fleet leads",
      whyThisFounder: "",
      evidenceRequirements: [],
      needsPersonalStory: true,
    },
    voiceContext: "voice",
    revising: null,
  },
  review: { approvedFacts: [], avoidPhrases: [], styleRules: [] },
  judgeModel: "claude-sonnet-5-5",
};

/** In-memory store mirroring the database functions' rules. */
class MemoryStore implements RunStore {
  drafts: { payload: DraftPayload; cost: number }[] = [];
  feedback: FeedbackRunInput = { before: "Before text.", after: "After text.", format: "story" };
  signals: FeedbackSignal[] = [];
  async feedbackInput() {
    return this.feedback;
  }
  async completeFeedback(runId: string, _model: string, usage: Usage, signals: FeedbackSignal[]) {
    const run = this.runs.get(runId)!;
    run.status = "succeeded";
    run.cost += usage.costUsd;
    this.signals = signals;
    return signals.length;
  }
  candidates: RepetitionCandidate[] = [];
  async draftInput() {
    return DRAFT_INPUT;
  }
  async repetitionCandidates() {
    return this.candidates;
  }
  async completeDraft(runId: string, _model: string, usage: Usage, payload: DraftPayload) {
    this.runs.get(runId)!.status = "succeeded";
    this.drafts.push({ payload, cost: usage.costUsd });
  }
  runs = new Map<string, ClaimedRun & { status: string; retryAfter?: number | null; error?: string; cost: number }>();
  saved: GeneratedConcept[] = [];
  constructor(kinds: string[] = ["concept_batch"]) {
    kinds.forEach((kind, i) =>
      this.runs.set(`r${i}`, {
        id: `r${i}`,
        kind,
        model: "claude-opus-5-5",
        attempt: 0,
        params: {},
        status: "queued",
        cost: 0,
      }),
    );
  }
  async claim(runId?: string) {
    const run = [...this.runs.values()].find((r) => r.status === "queued" && (!runId || r.id === runId));
    if (!run) return null;
    run.status = "running";
    run.attempt += 1;
    return { ...run };
  }
  async conceptInput() {
    return INPUT;
  }
  async completeConcepts(runId: string, _model: string, usage: Usage, concepts: GeneratedConcept[]) {
    const run = this.runs.get(runId)!;
    run.status = "succeeded";
    run.cost += usage.costUsd;
    this.saved.push(...concepts);
    return concepts.length;
  }
  async fail(runId: string, code: FailureKind, message: string, retryAfter: number | null, usage: Usage | null) {
    const run = this.runs.get(runId)!;
    run.status = retryAfter !== null && run.attempt < 3 ? "queued" : "failed";
    run.retryAfter = retryAfter;
    run.error = `${code}: ${message}`;
    run.cost += usage?.costUsd ?? 0;
    return run.status as "queued" | "failed";
  }
}

describe("processRun", () => {
  it("generates and stores a concept batch, recording its cost", async () => {
    const store = new MemoryStore();
    const outcome = await processRun(store, new FakeLlmProvider());
    expect(outcome).toEqual({ runId: "r0", status: "succeeded" });
    expect(store.saved).toHaveLength(3);
    expect(store.runs.get("r0")!.cost).toBeGreaterThan(0);
  });

  it("returns null when nothing is due", async () => {
    const store = new MemoryStore([]);
    expect(await processRun(store, new FakeLlmProvider())).toBeNull();
  });

  it("retries a 429 with backoff, and fails after the third attempt", async () => {
    const store = new MemoryStore();
    const rateLimited = () => new LlmError("rate_limited", 7);
    const provider = new FakeLlmProvider(undefined, [rateLimited(), rateLimited(), rateLimited()]);
    expect(await processRun(store, provider)).toMatchObject({ status: "queued", error: "rate_limited" });
    expect(store.runs.get("r0")!.retryAfter).toBeGreaterThanOrEqual(7);
    expect(await processRun(store, provider)).toMatchObject({ status: "queued" });
    expect(await processRun(store, provider)).toMatchObject({ status: "failed", error: "rate_limited" });
    expect(provider.calls).toHaveLength(3);
  });

  it("retries a 5xx and then succeeds", async () => {
    const store = new MemoryStore();
    const fake = new FakeLlmProvider();
    const good = await fake.generateStructured({ ...(await sampleRequest()) });
    const provider = new FakeLlmProvider(undefined, [new LlmError("server"), good.data]);
    await processRun(store, provider);
    expect(await processRun(store, provider)).toEqual({ runId: "r0", status: "succeeded" });
  });

  it("never retries a 400, a refusal or an invalid answer", async () => {
    for (const error of [new LlmError("bad_request"), new LlmError("refusal")]) {
      const store = new MemoryStore();
      expect(await processRun(store, new FakeLlmProvider(undefined, [error]))).toMatchObject({ status: "failed" });
    }
    const store = new MemoryStore();
    const outcome = await processRun(store, new FakeLlmProvider(undefined, [{ concepts: [{ title: 42 }] }]));
    expect(outcome).toMatchObject({ status: "failed", error: "invalid_output" });
    // The tokens of the rejected answer still count toward spend.
    expect(store.runs.get("r0")!.cost).toBeGreaterThan(0);
    expect(store.runs.get("r0")!.error).toBe("invalid_output: The AI's answer did not have the expected shape.");
  });

  it("rejects an answer that breaks the database's limits, and an empty batch", async () => {
    const fake = new FakeLlmProvider();
    const good = (await fake.generateStructured(await sampleRequest())).data as { concepts: GeneratedConcept[] };
    const tooLong = { concepts: [{ ...good.concepts[0], title: "x".repeat(201) }] };
    for (const answer of [tooLong, { concepts: [] }]) {
      const store = new MemoryStore();
      expect(await processRun(store, new FakeLlmProvider(undefined, [answer]))).toMatchObject({
        error: "invalid_output",
      });
    }
  });

  it("keeps at most the number of concepts asked for", async () => {
    const fake = new FakeLlmProvider();
    const many = (await fake.generateStructured({ ...(await sampleRequest()), instruction: "exactly 7 concepts" }))
      .data;
    const store = new MemoryStore();
    await processRun(store, new FakeLlmProvider(undefined, [many]));
    expect(store.saved).toHaveLength(3);
  });

  it("fails a run kind it cannot process, with a readable reason", async () => {
    const store = new MemoryStore(["research"]);
    expect(await processRun(store, new FakeLlmProvider())).toMatchObject({ status: "failed", error: "unknown" });
    expect(store.runs.get("r0")!.error).toBe("unknown: No runner for research yet.");
  });
});

it("processDueRuns works through the queue", async () => {
  const store = new MemoryStore(["concept_batch", "concept_batch"]);
  const outcomes = await processDueRuns(store, new FakeLlmProvider());
  expect(outcomes.map((o) => o.status)).toEqual(["succeeded", "succeeded"]);
});

async function sampleRequest() {
  const { buildConceptPrompt, conceptBatchSchema } = await import("@/lib/prompts/concepts.v1");
  return {
    task: "concepts" as const,
    model: "claude-opus-5-5",
    ...buildConceptPrompt(INPUT),
    untrustedContext: [],
    schema: conceptBatchSchema,
    maxOutputTokens: 100,
    effort: "medium" as const,
  };
}

describe("draft runs", () => {
  const candidate: RepetitionCandidate = {
    compared_type: "draft",
    compared_id: "d-older",
    excerpt: "An older post about status updates",
    similarity: 0.42,
    same_argument: true,
  };

  it("stores the draft with placeholder, unsupported-claim and repetition flags, and the judge's cost", async () => {
    const store = new MemoryStore(["draft"]);
    store.candidates = [candidate];
    const provider = new FakeLlmProvider();
    expect(await processRun(store, provider)).toEqual({ runId: "r0", status: "succeeded" });
    const { payload, cost } = store.drafts[0];
    expect(payload.body).toContain("[FOUNDER TO SUPPLY: a time a repair status surprise cost you a day]");
    expect(payload.flags.map((f) => [f.source, f.kind, f.severity])).toEqual([
      ["placeholder", "needs_personal_context", "blocking"],
      ["claims", "unsupported_claim", "blocking"],
      ["repetition", "repetition", "warning"],
    ]);
    expect(payload.flags[2]).toMatchObject({ compared_type: "draft", compared_id: "d-older" });
    expect(payload.checks.map((c) => c.method)).toEqual(["fingerprint", "llm"]);
    expect(payload.claims).toEqual([expect.objectContaining({ support_status: "unsupported" })]);
    // Two calls: the draft (Opus) and the judge (Sonnet), both counted.
    expect(provider.calls.map((c) => [c.task, c.model])).toEqual([
      ["draft", "claude-opus-5-5"],
      ["repetition_judge", "claude-sonnet-5-5"],
    ]);
    expect(cost).toBeGreaterThan(0);
  });

  it("skips the judge when nothing similar exists", async () => {
    const store = new MemoryStore(["draft"]);
    const provider = new FakeLlmProvider();
    await processRun(store, provider);
    expect(provider.calls.map((c) => c.task)).toEqual(["draft"]);
    expect(store.drafts[0].payload.flags.some((f) => f.source === "repetition")).toBe(false);
  });

  it("falls back to the pre-filter when the judge fails, and still stores the draft", async () => {
    const store = new MemoryStore(["draft"]);
    store.candidates = [candidate, { ...candidate, compared_id: "weak", same_argument: false, similarity: 0.36 }];
    const fake = new FakeLlmProvider();
    const draft = (await fake.generateStructured({ ...(await draftRequest()) })).data;
    const provider = new FakeLlmProvider(undefined, [draft, new LlmError("server")]);
    expect(await processRun(store, provider)).toMatchObject({ status: "succeeded" });
    const repetition = store.drafts[0].payload.flags.filter((f) => f.source === "repetition");
    expect(repetition.map((f) => f.compared_id)).toEqual(["d-older"]);
    expect(repetition[0].message).toMatch(/^Makes the same argument as a draft/);
  });

  it("rejects a body that carries a rationale or sources, and stores nothing", async () => {
    const fake = new FakeLlmProvider();
    const draft = (await fake.generateStructured({ ...(await draftRequest()) })).data as { post_body: string };
    const leaky = { ...draft, post_body: `${draft.post_body}\n\nRationale: lead with the hook.` };
    const store = new MemoryStore(["draft"]);
    expect(await processRun(store, new FakeLlmProvider(undefined, [leaky]))).toMatchObject({
      status: "failed",
      error: "invalid_output",
    });
    expect(store.drafts).toEqual([]);
  });
});

async function draftRequest() {
  const { buildDraftPrompt, draftSchema } = await import("@/lib/prompts/draft.v1");
  return {
    task: "draft" as const,
    model: "claude-opus-5-5",
    ...buildDraftPrompt(DRAFT_INPUT.prompt),
    untrustedContext: [],
    schema: draftSchema,
    maxOutputTokens: 100,
    effort: "medium" as const,
  };
}

describe("founder rewrites and feedback (Phase 7)", () => {
  it("a rewrite run is written like a regeneration", async () => {
    const store = new MemoryStore(["rewrite"]);
    expect(await processRun(store, new FakeLlmProvider())).toEqual({ runId: "r0", status: "succeeded" });
    expect(store.drafts).toHaveLength(1);
  });

  it("a feedback run proposes signals from the founder's edits", async () => {
    const store = new MemoryStore(["feedback_classification"]);
    const provider = new FakeLlmProvider();
    expect(await processRun(store, provider)).toEqual({ runId: "r0", status: "succeeded" });
    expect(store.signals.map((s) => s.kind)).toEqual(["stable_preference", "one_off"]);
    expect(provider.calls[0]).toMatchObject({ task: "feedback", effort: "low" });
    expect(store.runs.get("r0")!.cost).toBeGreaterThan(0);
  });

  it("drops empty statements and format preferences without a format, and keeps at most five", async () => {
    const store = new MemoryStore(["feedback_classification"]);
    const signal = (kind: string, statement: string, format: string | null = null) => ({ kind, statement, format });
    const answer = {
      signals: [
        signal("one_off", "  "),
        signal("format_preference", "Number first", null),
        signal("format_preference", "Number first", "data_insight"),
        ...Array.from({ length: 6 }, (_, i) => signal("one_off", `Edit ${i}`)),
      ],
    };
    await processRun(store, new FakeLlmProvider(undefined, [answer]));
    expect(store.signals).toHaveLength(5);
    expect(store.signals[0]).toEqual({ kind: "format_preference", statement: "Number first", format: "data_insight" });
  });

  it("an answer outside the allowed kinds is invalid (an admin-only kind included)", async () => {
    const store = new MemoryStore(["feedback_classification"]);
    const answer = { signals: [{ kind: "editorial_correction", statement: "Don't name competitors", format: null }] };
    expect(await processRun(store, new FakeLlmProvider(undefined, [answer]))).toMatchObject({
      status: "failed",
      error: "invalid_output",
    });
  });
});
