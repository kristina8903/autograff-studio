import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

try {
  process.loadEnvFile(".env.local");
} catch {
  // CI writes .env.local with `npm run env:local`.
}

export default defineConfig({
  resolve: { alias: { "@": fileURLToPath(new URL("./", import.meta.url)) } },
  test: { include: ["tests/db/**/*.test.ts"], environment: "node" },
});
