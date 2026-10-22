import "server-only";
import { z } from "zod";
import { parseEnv } from "@/lib/env";

const MODEL = z.string().regex(/^claude-[a-z0-9-]+$/, "must be a Claude model ID such as claude-opus-5-5");

const serverEnvSchema = z
  .object({
    SUPABASE_SECRET_KEY: z
      .string()
      .min(20)
      .refine((key) => !key.startsWith("sb_publishable_"), "must be the secret key, not the publishable key"),
    // The fake provider unless explicitly switched on (docs/INTEGRATIONS.md §2).
    LLM_PROVIDER: z.enum(["fake", "anthropic"], { error: "must be fake or anthropic" }).default("fake"),
    ANTHROPIC_API_KEY: z.string().optional(),
    // Web research: the fake unless switched on; Claude's web search uses the same key (D-06).
    RESEARCH_PROVIDER: z.enum(["fake", "anthropic"], { error: "must be fake or anthropic" }).default("fake"),
    LLM_MODEL_DRAFT: MODEL.default("claude-opus-5-5"),
    LLM_MODEL_EXTRACT: MODEL.default("claude-sonnet-5-5"),
    // Protects /api/jobs/tick. Vercel Cron sends it as a bearer token.
    CRON_SECRET: z.string().min(16, "must be at least 16 characters").optional(),
  })
  .superRefine((env, ctx) => {
    if (
      (env.LLM_PROVIDER === "anthropic" || env.RESEARCH_PROVIDER === "anthropic") &&
      !env.ANTHROPIC_API_KEY?.startsWith("sk-ant-")
    )
      ctx.addIssue({
        code: "custom",
        path: ["ANTHROPIC_API_KEY"],
        message: "must be an Anthropic API key (sk-ant-…) when LLM_PROVIDER or RESEARCH_PROVIDER is anthropic",
      });
  });

export type ServerEnv = z.infer<typeof serverEnvSchema>;

const KEYS = [
  "SUPABASE_SECRET_KEY",
  "LLM_PROVIDER",
  "ANTHROPIC_API_KEY",
  "RESEARCH_PROVIDER",
  "LLM_MODEL_DRAFT",
  "LLM_MODEL_EXTRACT",
  "CRON_SECRET",
] as const;

export function parseServerEnv(source: Record<string, string | undefined>): ServerEnv {
  // Empty strings count as unset, so "LLM_PROVIDER=" in a file means the default.
  return parseEnv(serverEnvSchema, Object.fromEntries(KEYS.map((key) => [key, source[key] || undefined])));
}

/** Server-only secrets. Fails fast with a clear message when misconfigured. */
export function serverEnv(): ServerEnv {
  return parseServerEnv(process.env);
}
