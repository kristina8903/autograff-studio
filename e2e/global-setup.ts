import { resetDatabase } from "./helpers";

// Fresh seeded database and an empty mailbox for every run.
export default async function globalSetup() {
  await resetDatabase("inherit");
  await fetch("http://127.0.0.1:54324/api/v1/messages", { method: "DELETE" });
}
