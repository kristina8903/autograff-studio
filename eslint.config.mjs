import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

// The secret-key client bypasses row-level security. Only the audited
// operations in lib/server/admin/ may use it (docs/SECURITY.md §4).
const SECRET_CLIENT = {
  group: ["@/lib/server/admin/client", "**/server/admin/client"],
  message: "Only lib/server/admin/* may use the secret-key client.",
};
// Vendor SDKs only behind their provider interface (docs/ARCHITECTURE.md §4.4).
const VENDOR_SDK = {
  group: ["@anthropic-ai/sdk", "@anthropic-ai/sdk/*"],
  message:
    "Only lib/providers/llm/anthropic.ts and lib/providers/research/anthropic.ts may import the Anthropic SDK; use lib/providers/llm or lib/providers/research.",
};
const restrict = (...patterns) => ["error", { patterns }];

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  { rules: { "no-restricted-imports": restrict(SECRET_CLIENT, VENDOR_SDK) } },
  { files: ["lib/server/admin/**"], rules: { "no-restricted-imports": restrict(VENDOR_SDK) } },
  {
    files: ["lib/providers/llm/anthropic.ts", "lib/providers/research/anthropic.ts"],
    rules: { "no-restricted-imports": restrict(SECRET_CLIENT) },
  },
  globalIgnores([".next/**", "out/**", "build/**", "next-env.d.ts", "playwright-report/**", "test-results/**"]),
]);

export default eslintConfig;
