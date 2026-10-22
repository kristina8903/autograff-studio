import "server-only";
import { serverEnv } from "@/lib/server/env";
import { AnthropicResearchProvider } from "./anthropic";
import { FakeResearchProvider } from "./fake";
import type { ResearchProvider } from "./types";

/** The configured provider: the fake unless RESEARCH_PROVIDER=anthropic and an Anthropic key is set. */
export function researchProvider(): ResearchProvider {
  const env = serverEnv();
  return env.RESEARCH_PROVIDER === "anthropic"
    ? new AnthropicResearchProvider(env.ANTHROPIC_API_KEY!)
    : new FakeResearchProvider();
}
