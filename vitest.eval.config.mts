import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

// Opt-in evaluations that make REAL AI calls (npm run eval:generation, eval:voice).
// Never part of `npm test` or CI. Each has a hard cost cap (tests/eval/budget.ts).
try {
  process.loadEnvFile(".env.local");
} catch {
  // Optional; ANTHROPIC_API_KEY can come from the shell.
}

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./", import.meta.url)),
      "server-only": fileURLToPath(new URL("./tests/server-only-stub.ts", import.meta.url)),
    },
  },
  test: { include: ["tests/eval/**/*.eval.ts"], environment: "node", testTimeout: 600_000 },
});
