import { describe, expect, it } from "vitest";
import { EnvConfigError, parsePublicEnv } from "@/lib/env";
import { parseServerEnv } from "@/lib/server/env";

const validPublic = {
  NEXT_PUBLIC_APP_URL: "http://localhost:3000",
  NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321",
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_example",
};

describe("environment validation", () => {
  it("accepts a complete public environment", () => {
    expect(parsePublicEnv(validPublic)).toEqual(validPublic);
  });
  it("fails fast when a public value is missing", () => {
    expect(() => parsePublicEnv({ ...validPublic, NEXT_PUBLIC_SUPABASE_URL: undefined })).toThrow();
  });
  it("refuses a secret key in the browser-visible slot", () => {
    expect(() => parsePublicEnv({ ...validPublic, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_secret_oops" })).toThrow(
      /publishable/,
    );
  });
  it("refuses a missing or publishable server secret", () => {
    expect(() => parseServerEnv({})).toThrow();
    expect(() => parseServerEnv({ SUPABASE_SECRET_KEY: "sb_publishable_xxxxxxxxxxxxxxxxxxxx" })).toThrow(/secret key/);
    expect(parseServerEnv({ SUPABASE_SECRET_KEY: "sb_secret_xxxxxxxxxxxxxxxxxxxxxx" }).SUPABASE_SECRET_KEY).toMatch(
      /^sb_secret_/,
    );
  });

  it("names each bad variable and what is wrong, never its value", () => {
    let caught: unknown;
    try {
      parsePublicEnv({
        ...validPublic,
        NEXT_PUBLIC_APP_URL: "autograff-studio.vercel.app",
        NEXT_PUBLIC_SUPABASE_URL: undefined,
      });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(EnvConfigError);
    const { problems, message } = caught as EnvConfigError;
    expect(problems).toEqual([
      "NEXT_PUBLIC_APP_URL must be a full address starting with https:// (or http:// locally)",
      "NEXT_PUBLIC_SUPABASE_URL is not set",
    ]);
    expect(message).not.toContain("autograff-studio.vercel.app");
  });
});
