import { describe, expect, it } from "vitest";
import { costOf, estimateMaxCost, priceOf, spendStatus, usd } from "./pricing";
import { MAX_ATTEMPTS, kindFromStatus, retryDelaySeconds } from "./retry";

describe("pricing", () => {
  it("prices usage per million tokens, including cache reads and writes", () => {
    // 10k in × $4 + 2k out × $20 + 50k cache read × $0.20 + 8k cache write × $5, per 1M.
    expect(
      costOf("claude-opus-5-5", {
        inputTokens: 10_000,
        outputTokens: 2_000,
        cacheReadTokens: 50_000,
        cacheWriteTokens: 8_000,
      }),
    ).toBeCloseTo(0.04 + 0.04 + 0.01 + 0.04, 10);
  });

  it("assumes the most expensive price for an unknown model", () => {
    expect(priceOf("claude-something-new")).toEqual(priceOf("claude-opus-4-8"));
  });

  it("estimates an upper bound: ~3 characters per token and every output token", () => {
    // 30,000 characters → 10,000 tokens × $4 + 16,000 output × $20, per 1M.
    expect(estimateMaxCost("claude-opus-5-5", 30_000, 16_000)).toBeCloseTo(0.04 + 0.32, 10);
  });

  it("formats dollars", () => {
    expect(usd(0.4249)).toBe("$0.42");
    expect(usd(0.0031)).toBe("$0.003");
    expect(usd(0)).toBe("$0.00");
  });

  it("warns at 80% of the monthly budget", () => {
    expect(spendStatus(7.99, 10)).toMatchObject({ warn: false, exhausted: false });
    expect(spendStatus(8, 10)).toMatchObject({ warn: true, exhausted: false });
    expect(spendStatus(10, 10)).toMatchObject({ warn: true, exhausted: true });
    expect(spendStatus(0, 0)).toMatchObject({ exhausted: true });
  });
});

describe("retry", () => {
  it("classifies HTTP statuses", () => {
    expect([429, 529, 500, 503, 408, 400, 404, 401, 403].map(kindFromStatus)).toEqual([
      "rate_limited",
      "overloaded",
      "server",
      "server",
      "timeout",
      "bad_request",
      "bad_request",
      "auth",
      "auth",
    ]);
    expect(kindFromStatus(undefined)).toBe("network");
  });

  it("retries 429, 5xx and network errors with backoff, at most 3 attempts in total", () => {
    const noJitter = () => 0;
    expect(retryDelaySeconds("rate_limited", 1, null, noJitter)).toBe(5);
    expect(retryDelaySeconds("server", 2, null, noJitter)).toBe(10);
    expect(retryDelaySeconds("network", MAX_ATTEMPTS, null, noJitter)).toBeNull();
  });

  it("honors retry-after", () => {
    expect(retryDelaySeconds("rate_limited", 1, 40, () => 0)).toBe(40);
  });

  it("never retries a bad request, refusal or invalid output", () => {
    for (const kind of ["bad_request", "auth", "refusal", "max_tokens", "invalid_output"] as const)
      expect(retryDelaySeconds(kind, 1)).toBeNull();
  });
});
