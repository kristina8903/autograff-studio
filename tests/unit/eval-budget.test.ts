import { expect, it } from "vitest";
import { z } from "zod";
import { CappedProvider, evalEnabled } from "../eval/budget";

it("the evals are off unless explicitly confirmed with a key", () => {
  const saved = { confirm: process.env.EVAL_CONFIRM, key: process.env.ANTHROPIC_API_KEY };
  try {
    process.env.ANTHROPIC_API_KEY = "sk-ant-test";
    delete process.env.EVAL_CONFIRM;
    expect(evalEnabled()).toBe(false);
    process.env.EVAL_CONFIRM = "1";
    expect(evalEnabled()).toBe(true);
    delete process.env.ANTHROPIC_API_KEY;
    expect(evalEnabled()).toBe(false);
  } finally {
    for (const [name, value] of [
      ["EVAL_CONFIRM", saved.confirm],
      ["ANTHROPIC_API_KEY", saved.key],
    ] as const)
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
  }
});

it("refuses a call that could exceed the cap, before making it", async () => {
  const ai = new CappedProvider(0.01);
  await expect(
    ai.generate({
      task: "draft",
      model: "claude-opus-5-5",
      system: "x",
      trustedContext: [],
      untrustedContext: [],
      instruction: "y",
      schema: z.object({}),
      maxOutputTokens: 16_000, // up to $0.32 on its own
      effort: "low",
    }),
  ).rejects.toThrow(/^Refused: this call could cost up to \$0\.32/);
  expect(ai.spent).toBe(0);
});
