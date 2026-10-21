// Fails if code references any NEXT_PUBLIC_ variable outside the allowlist.
// Anything prefixed NEXT_PUBLIC_ is shipped to the browser (docs/SECURITY.md §8).
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const ALLOWED = new Set(["NEXT_PUBLIC_APP_URL", "NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY"]);
const ROOTS = ["app", "components", "lib", "proxy.ts", "next.config.ts"];
const SKIP = new Set(["node_modules", ".next"]);

function* files(path) {
  if (statSync(path).isDirectory()) {
    for (const entry of readdirSync(path)) if (!SKIP.has(entry)) yield* files(join(path, entry));
  } else if (/\.(m?[jt]sx?)$/.test(path)) {
    yield path;
  }
}

const problems = [];
for (const root of ROOTS) {
  try {
    statSync(root);
  } catch {
    continue;
  }
  for (const file of files(root)) {
    for (const match of readFileSync(file, "utf8").matchAll(/NEXT_PUBLIC_[A-Z0-9_]+/g)) {
      if (!ALLOWED.has(match[0])) problems.push(`${file}: ${match[0]}`);
    }
  }
}
if (problems.length) {
  console.error("Disallowed NEXT_PUBLIC_ variables (these would be exposed to the browser):\n" + problems.join("\n"));
  process.exit(1);
}
console.log("check-public-env: ok");
