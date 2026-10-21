import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    // The secret-key client bypasses row-level security. Only the audited
    // operations in lib/server/admin/ may use it (docs/SECURITY.md §4).
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["@/lib/server/admin/client", "**/server/admin/client"],
              message: "Only lib/server/admin/* may use the secret-key client.",
            },
          ],
        },
      ],
    },
  },
  {
    files: ["lib/server/admin/**"],
    rules: { "no-restricted-imports": "off" },
  },
  globalIgnores([".next/**", "out/**", "build/**", "next-env.d.ts", "playwright-report/**", "test-results/**"]),
]);

export default eslintConfig;
