import "server-only";
import { z } from "zod";
import { parseEnv } from "@/lib/env";

const serverEnvSchema = z.object({
  SUPABASE_SECRET_KEY: z
    .string()
    .min(20)
    .refine((key) => !key.startsWith("sb_publishable_"), "must be the secret key, not the publishable key"),
});

export type ServerEnv = z.infer<typeof serverEnvSchema>;

export function parseServerEnv(source: Record<string, string | undefined>): ServerEnv {
  return parseEnv(serverEnvSchema, { SUPABASE_SECRET_KEY: source.SUPABASE_SECRET_KEY });
}

/** Server-only secrets. Fails fast with a clear message when misconfigured. */
export function serverEnv(): ServerEnv {
  return parseServerEnv(process.env);
}
