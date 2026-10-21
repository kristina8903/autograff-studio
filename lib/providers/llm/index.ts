import "server-only";
import { serverEnv } from "@/lib/server/env";
import { AnthropicProvider } from "./anthropic";
import { FakeLlmProvider } from "./fake";
import type { LlmProvider } from "./types";

/** The configured provider: the fake unless LLM_PROVIDER=anthropic and a key is set. */
export function llmProvider(): LlmProvider {
  const env = serverEnv();
  return env.LLM_PROVIDER === "anthropic" ? new AnthropicProvider(env.ANTHROPIC_API_KEY!) : new FakeLlmProvider();
}

export function llmModels() {
  const env = serverEnv();
  return { draft: env.LLM_MODEL_DRAFT, extract: env.LLM_MODEL_EXTRACT };
}
