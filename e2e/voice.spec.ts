import { execFileSync } from "node:child_process";
import { expect, test, type Page } from "@playwright/test";
import { accessTokenFrom, signInAdmin, signInWithCode, SUPABASE_URL } from "./helpers";

// Phase 3 acceptance criteria (docs/PHASES.md) as one ordered story.
test.describe.configure({ mode: "serial" });

const ADMIN = "local-admin@autograff.ai";
const CEO = "00000000-0000-4000-8000-0000000000f1";
const CTO = "00000000-0000-4000-8000-0000000000f2";
const COO = "00000000-0000-4000-8000-0000000000f3";
const mfa = { secret: "" };
let admin: Page;

test.beforeAll(async ({ browser }) => {
  // Fresh seed: this file must not depend on what other spec files changed.
  execFileSync("npx", ["supabase", "db", "reset"], { stdio: "ignore" });
  admin = await (await browser.newContext()).newPage();
  await signInAdmin(admin, ADMIN, mfa);
});

test("editing a voice profile creates a new version and earlier versions stay readable", async () => {
  await admin.getByRole("link", { name: "Voice", exact: true }).click();
  await admin.getByRole("table", { name: "Voice" }).getByRole("link", { name: "Local CEO" }).click();
  await expect(admin.getByText("Current version: v1.")).toBeVisible();
  await admin.getByLabel("Phrases to avoid").fill("game-changer\nIn today's fast-paced world\nsynergy");
  await admin.getByLabel("Reason for the change").fill("Expand the avoid list");
  await admin.getByRole("button", { name: "Save as version 2" }).click();
  await expect(admin.getByText("Saved as version 2.")).toBeVisible();

  await admin.getByRole("link", { name: /^v1/ }).click();
  await expect(admin.getByText("read-only")).toBeVisible();
  await expect(admin.getByText("synergy")).toHaveCount(0);

  await admin.getByRole("link", { name: /^v2/ }).click();
  const changes = admin.getByRole("region", { name: "Changes from the previous version" });
  await expect(changes).toContainText("Phrases to avoid");
  await expect(changes).toContainText("synergy");
});

test("a stable preference is accepted only by applying it to a new profile version", async () => {
  await admin.getByRole("link", { name: "Feedback", exact: true }).click();
  const feedback = admin.getByRole("table", { name: "Feedback" });
  const stable = feedback.getByRole("row").filter({ hasText: "Never open with a question." });
  const oneOff = feedback.getByRole("row").filter({ hasText: "Shorten the second paragraph" });
  await expect(stable.getByRole("button", { name: "Accept" })).toHaveCount(0);
  await expect(oneOff.getByRole("link", { name: "Apply to voice profile" })).toHaveCount(0);

  await stable.getByRole("link", { name: "Apply to voice profile" }).click();
  await expect(admin.getByRole("region", { name: "Feedback being applied" })).toContainText(
    "Never open with a question.",
  );
  await admin.getByLabel("Writing habits").fill("Ends with a question to the reader\nNever opens with a question");
  await admin.getByRole("button", { name: "Save as version 3" }).click();
  await expect(admin.getByText("Saved as version 3.")).toBeVisible();
  await expect(admin.getByRole("link", { name: /^v3/ })).toContainText("from feedback");

  await admin.goto("/admin/feedback");
  await oneOff.getByRole("button", { name: "Accept" }).click();
  await expect(oneOff).toHaveCount(0);
  await admin.getByRole("link", { name: "Reviewed" }).click();
  const applied = feedback.getByRole("row").filter({ hasText: "Never open with a question." });
  await expect(applied).toContainText("accepted");
  await expect(applied.getByRole("link", { name: "Voice profile v3" })).toBeVisible();
  await expect(feedback.getByRole("row").filter({ hasText: "Shorten the second paragraph" })).not.toContainText(
    "Voice profile",
  );
});

test("pasted LinkedIn posts are added once each", async () => {
  await admin.goto(`/admin/voice/${CTO}/examples`);
  const posts = [
    "URL: https://www.linkedin.com/posts/cto-a\nDate: 2026-09-01\nAPIs are promises to other teams.",
    "Integrations fail at the edges, not the middle.",
    "APIs are promises to other teams.",
  ].join("\n---\n");
  await admin.getByLabel("Posts").fill(posts);
  await admin.getByLabel("Topics for all").fill("Integrations, APIs");
  await admin.getByRole("button", { name: "Add posts" }).click();
  await expect(admin.getByText("Added 2 examples. Skipped 1 already in the library.")).toBeVisible();
  const examples = admin.getByRole("table", { name: "Examples" });
  await expect(examples.getByRole("row").filter({ hasText: "APIs are promises" })).toContainText("2026-09-01");
  await expect(examples.getByRole("row").filter({ hasText: "Integrations fail" }).getByLabel("Topics")).toHaveValue(
    "apis, integrations",
  );
});

test("a LinkedIn export imports its posts, skipping reposts and posts already in the library", async () => {
  await admin.goto(`/admin/voice/${COO}/examples`);
  const csv = [
    "Date,ShareLink,ShareCommentary,SharedUrl,MediaUrl,Visibility",
    '2026-07-01 08:00:00,https://www.linkedin.com/feed/update/urn%3Ali%3Ashare%3A10,"Throughput is a team sport.\nHere is why.",,,MEMBER_NETWORK',
    "2026-07-02 08:00:00,https://www.linkedin.com/feed/update/urn%3Ali%3Ashare%3A11,,https://example.com,,MEMBER_NETWORK",
    '2026-07-03 08:00:00,https://www.linkedin.com/feed/update/urn%3Ali%3Ashare%3A12,"Every board needs one owner.",,,MEMBER_NETWORK',
    '2026-09-20 08:00:00,https://www.linkedin.com/posts/local-coo-example-1,"Shop-floor throughput improves when everyone can see the same board. Here is how our team set one up.",,,MEMBER_NETWORK',
  ].join("\n");
  await admin
    .getByLabel("LinkedIn export file (Shares.csv)")
    .setInputFiles({ name: "Shares.csv", mimeType: "text/csv", buffer: Buffer.from(csv) });
  const preview = admin.getByRole("region", { name: "Import preview" });
  await expect(preview).toContainText("Found 3 posts, plus 1 repost(s) with no text of their own (skipped).");
  await preview.getByRole("button", { name: "Import 3 posts" }).click();
  await expect(admin.getByText("Imported 2 posts. Skipped 1 already in the library.")).toBeVisible();
  const examples = admin.getByRole("table", { name: "Examples" });
  await expect(examples.getByRole("row").filter({ hasText: "Every board needs one owner." })).toContainText(
    "2026-07-03",
  );
  await expect(examples.getByRole("row").filter({ hasText: "Throughput is a team sport." })).toContainText("approved");
});

test("a file that is not the posts export is refused, showing its columns", async () => {
  await admin.goto(`/admin/voice/${COO}/examples`);
  await admin.getByLabel("LinkedIn export file (Shares.csv)").setInputFiles({
    name: "messages.csv",
    mimeType: "text/csv",
    buffer: Buffer.from("CONVERSATION ID,FROM,TO,DATE,SUBJECT,CONTENT\n1,A,B,2026-01-01,Hi,Private text"),
  });
  await expect(admin.getByText(/doesn't look like the posts file/)).toContainText("Columns found: CONVERSATION ID");
  await expect(admin.getByRole("region", { name: "Import preview" })).toHaveCount(0);
});

test("retrieval uses only the founder's approved examples, never held-out ones", async () => {
  await admin.goto(`/admin/voice/${CEO}/examples`);
  await admin.getByLabel("Post format").selectOption("story");
  await admin.getByLabel("Post topics").fill("fleet maintenance");
  await admin.getByLabel("What the post is about").fill("waiting for a repair");
  await admin.getByRole("button", { name: "Show examples" }).click();
  const results = admin.getByRole("list", { name: "Retrieved examples" });
  await expect(results.getByRole("listitem").first()).toContainText("A fleet manager told me");
  await expect(results.getByRole("listitem")).toHaveCount(2);
  await expect(results).not.toContainText("predictability is what fleets pay for");
  await expect(results).not.toContainText("Draft notes, not for voice");
  await expect(results).not.toContainText("Shop-floor throughput");
});

test("a founder reads their own voice and examples, shares one, and sees nothing else", async ({ browser }) => {
  const founder = await (await browser.newContext()).newPage();
  await signInWithCode(founder, "local-ceo@autograff.ai");
  await founder.getByRole("link", { name: "Your voice" }).click();
  await expect(founder.getByRole("heading", { name: /Voice profile/ })).toContainText("v3");
  await expect(founder.getByText("Never opens with a question")).toBeVisible();
  const mine = founder.getByRole("list", { name: "Your examples" });
  await expect(mine).toContainText("A fleet manager told me");
  await expect(mine).not.toContainText("Shop-floor throughput");

  await founder.getByLabel("Something you wrote").fill("Every delay has a cause someone already knows.");
  await founder.getByRole("button", { name: "Share as an example" }).click();
  await expect(founder.getByText("Thanks. It's now one of your voice examples.")).toBeVisible();
  await expect(mine.getByRole("listitem").first()).toContainText("Every delay has a cause");

  for (const path of ["/admin/voice", `/admin/voice/${CEO}`, "/admin/feedback"]) {
    const response = await founder.goto(path);
    expect(response?.status(), path).toBe(404);
  }

  // Through the API with the founder's own token: own examples only, no feedback signals.
  const token = await accessTokenFrom(founder);
  const headers = { apikey: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? "", Authorization: `Bearer ${token}` };
  const examples = (await (
    await fetch(`${SUPABASE_URL}/rest/v1/writing_examples?select=founder_id`, { headers })
  ).json()) as {
    founder_id: string;
  }[];
  expect(examples.length).toBeGreaterThan(0);
  expect(new Set(examples.map((e) => e.founder_id))).toEqual(new Set([CEO]));
  const signals = (await (
    await fetch(`${SUPABASE_URL}/rest/v1/feedback_signals?select=id`, { headers })
  ).json()) as unknown[];
  expect(signals).toEqual([]);
});
