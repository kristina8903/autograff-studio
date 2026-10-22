// Which AI failures are retried, and when (docs/SECURITY.md §10): 429, 5xx and
// network errors are retried with exponential backoff and jitter, at most 3
// attempts in total, honoring retry-after. Everything else fails at once.

export const MAX_ATTEMPTS = 3;

export type FailureKind =
  | "rate_limited"
  | "overloaded"
  | "server"
  | "network"
  | "timeout"
  | "bad_request"
  | "auth"
  | "refusal"
  | "max_tokens"
  | "invalid_output"
  | "unknown";

const TRANSIENT: ReadonlySet<FailureKind> = new Set(["rate_limited", "overloaded", "server", "network", "timeout"]);

export function isTransient(kind: FailureKind): boolean {
  return TRANSIENT.has(kind);
}

export function kindFromStatus(status: number | undefined): FailureKind {
  if (status === undefined) return "network";
  if (status === 429) return "rate_limited";
  if (status === 529) return "overloaded";
  if (status === 408) return "timeout";
  if (status === 401 || status === 403) return "auth";
  if (status >= 500) return "server";
  if (status >= 400) return "bad_request";
  return "unknown";
}

/**
 * Seconds to wait before the next attempt, or null when the run should fail.
 * `attempt` is the attempt that just failed (1-based). `random` is injectable for tests.
 */
export function retryDelaySeconds(
  kind: FailureKind,
  attempt: number,
  retryAfterSeconds: number | null = null,
  random: () => number = Math.random,
): number | null {
  if (!isTransient(kind) || attempt >= MAX_ATTEMPTS) return null;
  const backoff = 5 * 2 ** (attempt - 1); // 5 s, then 10 s
  const jitter = Math.floor(random() * 3);
  return Math.min(300, Math.max(retryAfterSeconds ?? 0, backoff + jitter));
}

/** Messages the admin sees. Never the provider's raw text, which may echo input. */
export const FAILURE_MESSAGES: Record<FailureKind, string> = {
  rate_limited: "The AI service is busy (rate limited).",
  overloaded: "The AI service is overloaded.",
  server: "The AI service had an error.",
  network: "Could not reach the AI service.",
  timeout: "The AI service took too long to answer.",
  bad_request: "The AI service rejected the request.",
  auth: "The AI service rejected the API key. Check ANTHROPIC_API_KEY.",
  refusal: "The AI declined this request.",
  max_tokens: "The answer was cut off before it was complete.",
  invalid_output: "The AI's answer did not have the expected shape.",
  unknown: "Something went wrong.",
};
