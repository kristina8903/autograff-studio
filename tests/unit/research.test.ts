import { describe, expect, it } from "vitest";
import { FakeLlmProvider } from "@/lib/providers/llm/fake";
import { LlmError, type Usage } from "@/lib/providers/llm/types";
import { sourcesFromContent } from "@/lib/providers/research/citations";
import { FAKE_SOURCES, FakeResearchProvider } from "@/lib/providers/research/fake";
import {
  processRun,
  type ClaimedRun,
  type ResearchPayload,
  type ResearchRunInput,
  type RunStore,
} from "@/lib/server/generation/runner";
import type { FailureKind } from "@/lib/domain/retry";

const NOW = new Date("2026-10-22T12:00:00Z");

/** Only the research parts of the store; any other call fails the test. */
class ResearchStore implements Partial<RunStore> {
  calls: string[] = [];
  run: ClaimedRun & { status: string; error?: string; cost: number } = {
    id: "r0",
    kind: "research",
    model: "claude-sonnet-5-5",
    attempt: 0,
    params: { query: "repair approval delays" },
    status: "queued",
    cost: 0,
  };
  input: ResearchRunInput = { query: "repair approval delays", allowedDomains: [], blockedDomains: [] };
  stored: { payload: ResearchPayload; searches: number; cost: number } | null = null;
  async claim() {
    if (this.run.status !== "queued") return null;
    this.run.status = "running";
    this.run.attempt += 1;
    return { ...this.run };
  }
  async researchInput() {
    this.calls.push("researchInput");
    return this.input;
  }
  async completeResearch(_id: string, _model: string, usage: Usage, searches: number, payload: ResearchPayload) {
    this.calls.push("completeResearch");
    this.run.status = "succeeded";
    this.stored = { payload, searches, cost: usage.costUsd };
  }
  async fail(_id: string, code: FailureKind, message: string, retryAfter: number | null, usage: Usage | null) {
    this.calls.push("fail");
    this.run.status = retryAfter !== null && this.run.attempt < 3 ? "queued" : "failed";
    this.run.error = `${code}: ${message}`;
    this.run.cost += usage?.costUsd ?? 0;
    return this.run.status as "queued" | "failed";
  }
}

const run = (store: ResearchStore, llm = new FakeLlmProvider(), research = new FakeResearchProvider()) =>
  processRun(store as unknown as RunStore, llm, undefined, research, NOW);

describe("research runs", () => {
  it("stores each source with its dates and excerpt, and only findings found in the excerpt", async () => {
    const store = new ResearchStore();
    const llm = new FakeLlmProvider();
    expect(await run(store, llm)).toEqual({ runId: "r0", status: "succeeded" });
    const { payload, searches, cost } = store.stored!;
    expect(searches).toBe(2);
    // Two searches at $0.01 plus tokens: the search cost is in the run's cost.
    expect(cost).toBeGreaterThan(0.02);
    expect(
      payload.sources.map((s) => [s.canonical_url, s.publisher, s.published_at, s.published_at_precision]),
    ).toEqual([
      ["https://fleetresearch.example.org/2026-repair-report", "fleetresearch.example.org", "2026-03-04", "day"],
      ["https://shopnews.example.com/blog/approvals", "shopnews.example.com", null, "unknown"],
      ["https://blocked.example.net/listicle", "blocked.example.net", "2026-10-20", "day"],
    ]);
    expect(payload.sources[0].excerpt).toBe(FAKE_SOURCES[0].excerpts.join("\n"));
    expect(payload.sources[0].findings.map((f) => [f.claim_text, f.data?.value, f.verification_status])).toEqual([
      ["In 2025, the average repair cycle grew to 12.5 days.", "12.5", "machine_supported"],
      [
        "About 27% of delays came from waiting for approvals, a survey of 1,200 fleets found.",
        "27",
        "machine_supported",
      ],
    ]);
    expect(payload.sources[0].findings[0]).toMatchObject({ event_date: "2025-01-01", event_date_precision: "year" });
    // The extraction is tool-less and reads the excerpts as outside data.
    expect(llm.calls[0]).toMatchObject({ task: "findings", model: "claude-sonnet-5-5", effort: "low" });
    expect(llm.calls[0].trustedContext.map((b) => b.label)).toEqual(["Research question"]);
    expect(llm.calls[0].untrustedContext.map((b) => b.label)).toEqual(["Excerpts"]);
  });

  it("criterion 4: an injected instruction changes nothing: no new URL, no extra action, the same shape", async () => {
    const store = new ResearchStore();
    await run(store);
    const { payload } = store.stored!;
    // The obedient fake added a finding with a link and a quote not in the excerpt: rejected and counted.
    expect(payload.findings_rejected).toBe(1);
    const injected = payload.sources[1];
    expect(injected.findings.map((f) => f.claim_text)).toEqual([
      "Shops reported waiting 4 days on average for repair approvals.",
    ]);
    // Every URL stored is one the provider returned.
    const providerUrls = FAKE_SOURCES.map((s) => s.url);
    expect(payload.sources.every((s) => providerUrls.includes(s.url))).toBe(true);
    expect(JSON.stringify(payload.sources.flatMap((s) => s.findings))).not.toMatch(/evil|https?:/);
    // The run did nothing but read its input and store its result.
    expect(store.calls).toEqual(["researchInput", "completeResearch"]);
    expect(Object.keys(payload).sort()).toEqual(["findings_rejected", "sources"]);
    for (const s of payload.sources)
      expect(Object.keys(s).sort()).toEqual(
        [
          "canonical_url",
          "excerpt",
          "findings",
          "page_age",
          "published_at",
          "published_at_precision",
          "publisher",
          "title",
          "url",
        ].sort(),
      );
  });

  it("applies our domain lists to whatever the provider returned", async () => {
    const blocked = new ResearchStore();
    blocked.input = { ...blocked.input, blockedDomains: ["example.net"] };
    const research = new FakeResearchProvider();
    await run(blocked, new FakeLlmProvider(), research);
    expect(research.calls[0]).toMatchObject({ blockedDomains: ["example.net"], maxSearches: 5 });
    expect(blocked.stored!.payload.sources.map((s) => s.publisher)).toEqual([
      "fleetresearch.example.org",
      "shopnews.example.com",
    ]);

    const allowed = new ResearchStore();
    allowed.input = { ...allowed.input, allowedDomains: ["fleetresearch.example.org"] };
    await run(allowed);
    expect(allowed.stored!.payload.sources.map((s) => s.publisher)).toEqual(["fleetresearch.example.org"]);
  });

  it("refuses a source whose URL isn't a web address, and stores a page once", async () => {
    const store = new ResearchStore();
    const research = new FakeResearchProvider([
      { url: "javascript:alert(1)", title: "x", pageAge: null, excerpts: ["12 shops."] },
      { ...FAKE_SOURCES[0] },
      { ...FAKE_SOURCES[0], url: "https://fleetresearch.example.org/2026-repair-report/#section" },
    ]);
    await run(store, new FakeLlmProvider(), research);
    expect(store.stored!.payload.sources).toHaveLength(1);
  });

  it("keeps the search cost when the extraction fails", async () => {
    const store = new ResearchStore();
    await run(store, new FakeLlmProvider(undefined, [new LlmError("bad_request")]));
    expect(store.run.status).toBe("failed");
    expect(store.run.cost).toBeGreaterThan(0.02);
  });

  it("stores nothing but the query when nothing was found", async () => {
    const store = new ResearchStore();
    const llm = new FakeLlmProvider();
    await run(store, llm, new FakeResearchProvider([]));
    expect(store.stored!.payload).toEqual({ sources: [], findings_rejected: 0 });
    expect(llm.calls).toHaveLength(0);
  });
});

describe("Claude web search responses (recorded shape)", () => {
  // Shaped like the documented response: search results, then text with citations.
  const content = [
    { type: "text", text: "I'll search for that." },
    { type: "server_tool_use", id: "srvtoolu_1", name: "web_search", input: { query: "repair delays approvals" } },
    {
      type: "web_search_tool_result",
      tool_use_id: "srvtoolu_1",
      content: [
        {
          type: "web_search_result",
          url: "https://fleetresearch.example.org/report",
          title: "Fleet Repair Report",
          encrypted_content: "Eq…",
          page_age: "March 4, 2026",
        },
        {
          type: "web_search_result",
          url: "https://uncited.example.com/",
          title: "Never cited",
          encrypted_content: "Eq…",
          page_age: null,
        },
        { type: "web_search_result", url: "javascript:alert(1)", title: "bad", encrypted_content: "Eq…" },
      ],
    },
    {
      type: "web_search_tool_result",
      tool_use_id: "srvtoolu_2",
      content: { type: "web_search_tool_result_error", error_code: "max_uses_exceeded" },
    },
    {
      type: "text",
      text: "About 27% of delays came from approvals.",
      citations: [
        {
          type: "web_search_result_location",
          url: "https://fleetresearch.example.org/report",
          title: "Fleet Repair Report",
          encrypted_index: "Eo…",
          cited_text: "About 27% of delays came from waiting for approvals, a survey of 1,200 fleets found.",
        },
        {
          type: "web_search_result_location",
          url: "https://fleetresearch.example.org/report",
          title: "Fleet Repair Report",
          encrypted_index: "Eo…",
          cited_text: "About 27% of delays came from waiting for approvals, a survey of 1,200 fleets found.",
        },
        {
          // A URL the search never returned: dropped.
          type: "web_search_result_location",
          url: "https://invented.example.com/",
          title: "Invented",
          encrypted_index: "Eo…",
          cited_text: "Made-up text.",
        },
      ],
    },
  ];

  it("keeps cited pages the search returned, with the cited text as the excerpt", () => {
    expect(sourcesFromContent(content)).toEqual([
      {
        url: "https://fleetresearch.example.org/report",
        title: "Fleet Repair Report",
        pageAge: "March 4, 2026",
        excerpts: ["About 27% of delays came from waiting for approvals, a survey of 1,200 fleets found."],
      },
    ]);
  });

  it("ignores the model's own words entirely", () => {
    const sources = sourcesFromContent(content);
    expect(JSON.stringify(sources)).not.toContain("About 27% of delays came from approvals.");
  });
});
