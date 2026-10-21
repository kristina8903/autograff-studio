import { describe, expect, it } from "vitest";
import { readSnapshot } from "@/lib/domain/briefs";
import type { FailureKind } from "@/lib/domain/retry";
import type { ConceptPromptInput, GeneratedConcept } from "@/lib/prompts/concepts.v1";
import { FakeLlmProvider } from "@/lib/providers/llm/fake";
import { LlmError, type Usage } from "@/lib/providers/llm/types";
import { processDueRuns, processRun, type ClaimedRun, type RunStore } from "@/lib/server/generation/runner";

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

/** In-memory store mirroring the database functions' rules. */
class MemoryStore implements RunStore {
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
