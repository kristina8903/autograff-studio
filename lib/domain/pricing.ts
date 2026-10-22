// AI prices per million tokens (docs/ARCHITECTURE.md §5.1). List prices from
// the Claude API reference, cached 2026-10-06 [V]; re-check at
// https://platform.claude.com/docs/en/about-claude/pricing before budgeting.

export type ModelPrice = { input: number; output: number; cacheRead: number; cacheWrite: number };

/** USD per 1M tokens. Cache writes are the 5-minute rate (1.25 × input). */
export const PRICES: Record<string, ModelPrice> = {
  "claude-opus-5-5": { input: 4, output: 20, cacheRead: 0.2, cacheWrite: 5 },
  "claude-sonnet-5-5": { input: 2, output: 10, cacheRead: 0.2, cacheWrite: 2.5 },
  "claude-haiku-5-5": { input: 0.1, output: 0.5, cacheRead: 0.01, cacheWrite: 0.125 },
  // Possible refusal fallbacks (the API may re-run a declined request on these).
  "claude-opus-5": { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25 },
  "claude-opus-4-8": { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25 },
};

/** For a model missing from the table, assume the most expensive price, so budgets stay safe. */
const MOST_EXPENSIVE: ModelPrice = Object.values(PRICES).reduce((max, price) =>
  price.output > max.output ? price : max,
);

export function priceOf(model: string): ModelPrice {
  return PRICES[model] ?? MOST_EXPENSIVE;
}

export type TokenUsage = {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
};

export function costOf(model: string, usage: TokenUsage): number {
  const p = priceOf(model);
  return (
    (usage.inputTokens * p.input +
      usage.outputTokens * p.output +
      usage.cacheReadTokens * p.cacheRead +
      usage.cacheWriteTokens * p.cacheWrite) /
    1_000_000
  );
}

/**
 * Upper-bound estimate made before a run: about 3 characters per input token
 * (English prose is closer to 4, so this overestimates), every output token
 * up to the cap, and no cache discount.
 */
export function estimateMaxCost(model: string, promptCharacters: number, maxOutputTokens: number): number {
  return costOf(model, {
    inputTokens: Math.ceil(promptCharacters / 3),
    outputTokens: maxOutputTokens,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
  });
}

/** "$0.42", "$0.003" for small amounts. */
export function usd(amount: number): string {
  return amount > 0 && amount < 0.01 ? `$${amount.toFixed(3)}` : `$${amount.toFixed(2)}`;
}

export type SpendStatus = { spent: number; budget: number; share: number; warn: boolean; exhausted: boolean };

/** Month-to-date spend against the monthly budget; warns at 80% (PHASES Phase 4, criterion 7). */
export function spendStatus(spent: number, budget: number): SpendStatus {
  const share = budget > 0 ? spent / budget : 1;
  return { spent, budget, share, warn: share >= 0.8, exhausted: share >= 1 };
}
