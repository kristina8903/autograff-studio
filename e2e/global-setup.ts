import { execFileSync } from "node:child_process";

// Fresh seeded database and an empty mailbox for every run.
export default async function globalSetup() {
  execFileSync("npx", ["supabase", "db", "reset"], { stdio: "inherit" });
  await fetch("http://127.0.0.1:54324/api/v1/messages", { method: "DELETE" });
}
