import { z } from "zod";

// The only values allowed to reach the browser (docs/SECURITY.md §8).
// `scripts/check-public-env.mjs` fails the lint step if any other
// NEXT_PUBLIC_ variable appears in the code.
const FULL_URL = "must be a full address starting with https:// (or http:// locally)";

const publicEnvSchema = z.object({
  NEXT_PUBLIC_APP_URL: z.url({ error: FULL_URL }),
  NEXT_PUBLIC_SUPABASE_URL: z.url({ error: FULL_URL }),
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: z
    .string()
    .min(1)
    .refine((key) => !key.startsWith("sb_secret_"), "must be the publishable key, never the secret key"),
});

export type PublicEnv = z.infer<typeof publicEnvSchema>;

/**
 * A missing or malformed setting. The message names the variables and what is
 * wrong with them, never their values, so it is safe to log and to show.
 */
export class EnvConfigError extends Error {
  constructor(readonly problems: string[]) {
    super(`Invalid environment configuration: ${problems.join("; ")}`);
    this.name = "EnvConfigError";
  }
}

/** Parses with a schema, turning failures into an EnvConfigError that names each bad variable. */
export function parseEnv<T extends z.ZodType>(schema: T, input: Record<string, string | undefined>): z.infer<T> {
  const result = schema.safeParse(input);
  if (result.success) return result.data;
  const problems = result.error.issues.map((issue) => {
    const name = String(issue.path[0] ?? "environment");
    const missing = input[name] === undefined || input[name] === "";
    return `${name} ${missing ? "is not set" : issue.message}`;
  });
  throw new EnvConfigError(problems);
}

export function parsePublicEnv(source: Record<string, string | undefined>): PublicEnv {
  return parseEnv(publicEnvSchema, {
    NEXT_PUBLIC_APP_URL: source.NEXT_PUBLIC_APP_URL,
    NEXT_PUBLIC_SUPABASE_URL: source.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: source.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
  });
}

// Each variable is referenced by its full name so Next can inline it.
export function publicEnv(): PublicEnv {
  return parsePublicEnv({
    NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL,
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
  });
}
