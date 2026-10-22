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

describe("AI settings", () => {
  const secret = { SUPABASE_SECRET_KEY: "sb_secret_xxxxxxxxxxxxxxxxxxxxxx" };
  it("defaults to the fake provider and the planned models", () => {
    expect(parseServerEnv(secret)).toMatchObject({
      LLM_PROVIDER: "fake",
      LLM_MODEL_DRAFT: "claude-opus-5-5",
      LLM_MODEL_EXTRACT: "claude-sonnet-5-5",
    });
  });
  it("requires an Anthropic key when the anthropic provider is chosen, without echoing it", () => {
    expect(() => parseServerEnv({ ...secret, LLM_PROVIDER: "anthropic" })).toThrow(/ANTHROPIC_API_KEY is not set/);
    expect(() => parseServerEnv({ ...secret, LLM_PROVIDER: "anthropic", ANTHROPIC_API_KEY: "oops-wrong" })).toThrow(
      /must be an Anthropic API key/,
    );
    expect(() => parseServerEnv({ ...secret, LLM_PROVIDER: "anthropic", ANTHROPIC_API_KEY: "oops-wrong" })).not.toThrow(
      /oops-wrong/,
    );
    expect(
      parseServerEnv({ ...secret, LLM_PROVIDER: "anthropic", ANTHROPIC_API_KEY: "sk-ant-api-test" }).LLM_PROVIDER,
    ).toBe("anthropic");
  });
  it("keeps research on the fake unless switched on, and then needs the Anthropic key", () => {
    expect(parseServerEnv(secret).RESEARCH_PROVIDER).toBe("fake");
    expect(() => parseServerEnv({ ...secret, RESEARCH_PROVIDER: "anthropic" })).toThrow(/ANTHROPIC_API_KEY/);
    expect(() => parseServerEnv({ ...secret, RESEARCH_PROVIDER: "brave" })).toThrow(/RESEARCH_PROVIDER/);
    expect(
      parseServerEnv({ ...secret, RESEARCH_PROVIDER: "anthropic", ANTHROPIC_API_KEY: "sk-ant-api-test" })
        .RESEARCH_PROVIDER,
    ).toBe("anthropic");
  });
  it("rejects a malformed model ID and a short cron secret", () => {
    expect(() => parseServerEnv({ ...secret, LLM_MODEL_DRAFT: "gpt-4" })).toThrow(/LLM_MODEL_DRAFT/);
    expect(() => parseServerEnv({ ...secret, CRON_SECRET: "short" })).toThrow(/CRON_SECRET/);
  });
});
