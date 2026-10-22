import { execFileSync } from "node:child_process";
import { expect, test, type Page } from "@playwright/test";
import { SUPABASE_URL, accessTokenFrom, signInAdmin, signInWithCode } from "./helpers";

// Phase 7 acceptance criteria: sharing, founder review, approval, the
// material-edit rule, rewrites. Against the fake AI provider (no real calls).
test.describe.configure({ mode: "serial" });

const ADMIN = "local-admin@autograff.ai";
const MONTH = "2026-11";
const PLACEHOLDER = "[FOUNDER TO SUPPLY: a time a repair status surprise cost you a day]";
const STORY = "Last spring a van sat ready for two days because nobody called.";
const PUBLISHABLE_KEY = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? "";
const mfa = { secret: "" };
let admin: Page;
let founder: Page;
let draftPath = "";
const cspViolations: string[] = [];

const watchCsp = (page: Page) =>
  page.on("console", (message) => {
    if (/Content Security Policy|Refused to (execute|load|apply)/i.test(message.text()))
      cspViolations.push(message.text());
  });
const founderPath = () => draftPath.replace("/admin/drafts/", "/drafts/");
const flags = (page: Page) => page.getByRole("list", { name: "Review flags" }).locator(":scope > li");

test.beforeAll(async ({ browser }) => {
  execFileSync("npx", ["supabase", "db", "reset"], { stdio: "ignore" });
  admin = await (await browser.newContext()).newPage();
  founder = await (await browser.newContext()).newPage();
  watchCsp(admin);
  watchCsp(founder);
  await signInAdmin(admin, ADMIN, mfa);
  await signInWithCode(founder, "local-ceo@autograff.ai");
  await expect(founder).toHaveURL(/\/dashboard$/);

  // One concept that needs a personal story, and a draft of it.
  await admin.goto(`/admin/concepts?month=${MONTH}`);
  const section = admin.getByRole("region", { name: "Concepts for Local CEO" });
  await section.getByLabel("Concepts for Local CEO").selectOption("1");
  await section.getByRole("button", { name: "Generate concepts" }).click();
  const card = admin.getByRole("list", { name: "Local CEO's concepts" }).locator(":scope > li").first();
  await expect(card).toBeVisible({ timeout: 20_000 });
  await card.getByRole("button", { name: "Select" }).click();
  await card.getByRole("button", { name: "Write a draft" }).click();
  await expect(card.getByRole("link", { name: "Draft 1" })).toBeVisible({ timeout: 20_000 });
  await card.getByRole("link", { name: "Draft 1" }).click();
  await expect(admin).toHaveURL(/\/admin\/drafts\/[0-9a-f-]{36}$/);
  draftPath = new URL(admin.url()).pathname;
});

test("a draft the admin hasn't shared is invisible to its founder", async () => {
  await founder.goto("/drafts");
  await expect(founder.getByText("Nothing to review yet.")).toBeVisible();
  expect((await founder.goto(founderPath()))?.status()).toBe(404);
});

test("the admin shares the draft, choosing which flags the founder sees, and comments", async () => {
  await admin.goto(draftPath);
  const share = admin.getByRole("button", { name: "Share with the founder" });
  // Open blocking flags are always shown; the warning is the admin's choice.
  await expect(admin.getByRole("checkbox", { name: /^blocking: Founder to supply/ })).toBeDisabled();
  await expect(admin.getByRole("checkbox", { name: /^blocking: Founder to supply/ })).toBeChecked();
  await admin.getByLabel("Comment", { exact: true }).fill("Internal: double-check the approvals claim");
  await admin.getByLabel("Who sees it").selectOption("admin_internal");
  await admin.getByRole("button", { name: "Add comment" }).click();
  await expect(admin.getByText("Internal note added.")).toBeVisible();
  await share.click();
  // The share form goes away once the draft is with the founder.
  await expect(admin.getByText("with founder", { exact: true })).toBeVisible();
  await expect(share).toHaveCount(0);
  await admin.getByLabel("Comment", { exact: true }).fill("Could you add your own story here?");
  await admin.getByLabel("About this text (optional)").fill(PLACEHOLDER);
  await admin.getByLabel("Who sees it").selectOption("shared");
  await admin.getByRole("button", { name: "Add comment" }).click();
  await expect(admin.getByText("Comment shared with the founder.")).toBeVisible();
});

test("the founder reviews their draft without internal notes, and can't approve while blocked", async () => {
  await founder.goto("/dashboard");
  await expect(founder.getByText("1 draft is waiting for you.")).toBeVisible();
  await founder.getByRole("link", { name: "Drafts", exact: true }).click();
  await expect(founder.getByRole("table", { name: "Your drafts" })).toContainText("ready for your review");
  await founder.getByRole("table", { name: "Your drafts" }).getByRole("link").click();
  await expect(founder).toHaveURL(new RegExp(`${founderPath()}$`));

  await expect(founder.getByRole("article", { name: "Post text" })).toContainText(PLACEHOLDER);
  // Never the rationale or internal comments.
  await expect(founder.getByText("Fake rationale")).toHaveCount(0);
  await expect(founder.getByText("Internal: double-check")).toHaveCount(0);
  await expect(founder.getByRole("list", { name: "Comments" })).toContainText("Could you add your own story here?");

  const approve = founder.getByRole("button", { name: "Approve version 1" });
  await expect(approve).toBeDisabled();
  await expect(founder.getByText("Replace the [FOUNDER TO SUPPLY] placeholder first.")).toBeVisible();
  await expect(founder.getByRole("list", { name: "Things to check" })).toContainText(
    "isn't backed by an approved fact",
  );

  await founder.getByLabel("Comment", { exact: true }).fill("On it");
  await founder.getByRole("button", { name: "Add comment" }).click();
  await expect(founder.getByText("Comment added.")).toBeVisible();
});

test("the founder's edit is a new version; approval waits for the blocking claim", async () => {
  await founder.getByRole("button", { name: "Edit text" }).click();
  const body = founder.getByRole("textbox", { name: "Post text" });
  await body.fill((await body.inputValue()).replace(PLACEHOLDER, STORY));
  await founder.getByRole("button", { name: "Save as a new version" }).click();
  await expect(founder.getByText("Saved as version 2.")).toBeVisible();
  await founder.reload();
  await expect(founder.getByText("Version 2", { exact: true })).toBeVisible();
  expect((await founder.getByLabel("Changes").locator("ins").allTextContents()).join(" ")).toMatch(/spring.*van/);
  await expect(founder.getByRole("button", { name: "Approve version 2" })).toBeDisabled();
  await expect(founder.getByText(/^A blocking flag is still open/)).toBeVisible();

  // The admin checks the claim and resolves it.
  await admin.goto(draftPath);
  await expect(admin.getByText("Founder", { exact: true }).first()).toBeVisible();
  const claim = flags(admin).filter({ hasText: "isn't backed by an approved fact" });
  await claim.getByLabel("Reason").fill("Confirmed with the founder's ops data");
  await claim.getByRole("button", { name: "Resolve" }).click();
  await expect(claim).toContainText("resolved");
});

test("the founder approves the exact version; the admin sees who, which version and when", async () => {
  await founder.reload();
  await founder.getByLabel("Note (optional)").fill("Good to go");
  await founder.getByRole("button", { name: "Approve version 2" }).click();
  await expect(founder.getByRole("heading", { name: "You approved version 2" })).toBeVisible();

  await admin.reload();
  const approval = admin.getByRole("list", { name: "Approvals" }).locator(":scope > li").first();
  await expect(approval).toContainText("Approved v2");
  await expect(approval).toContainText("valid");
  await expect(approval).toContainText("local-ceo@autograff.ai");
  await expect(approval).toContainText(/hash [0-9a-f]{12}/);
  await expect(approval).toContainText("Good to go");
  await expect(admin.getByText("approved", { exact: true })).toBeVisible();
});

test("an admin's material edit withdraws the approval and returns the draft to review", async () => {
  await admin.getByRole("button", { name: "Edit text" }).click();
  const body = admin.getByRole("textbox", { name: "Post text" });
  await body.fill((await body.inputValue()).replace("two days", "three days"));
  await admin.getByRole("button", { name: "Save as a new version" }).click();
  await expect(admin.getByText("Saved as version 3.")).toBeVisible();
  await admin.reload();
  await expect(admin.getByText("in review", { exact: true })).toBeVisible();
  const approval = admin.getByRole("list", { name: "Approvals" }).locator(":scope > li").first();
  await expect(approval).toContainText("Withdrawn: material edit");

  await founder.goto("/drafts");
  await expect(founder.getByText("Nothing to review yet.")).toBeVisible();
});

test("approving a version that changed meanwhile is refused", async () => {
  await admin.getByRole("button", { name: "Share the new version with the founder" }).click();
  await expect(admin.getByText("with founder", { exact: true })).toBeVisible();
  await founder.goto(founderPath());
  await expect(founder.getByRole("button", { name: "Approve version 3" })).toBeEnabled();

  // The admin edits while the founder has the page open.
  await admin.reload();
  await admin.getByRole("button", { name: "Edit text" }).click();
  const body = admin.getByRole("textbox", { name: "Post text" });
  await body.fill((await body.inputValue()).replace("three days", "three whole days"));
  await admin.getByRole("button", { name: "Save as a new version" }).click();
  await expect(admin.getByText("Saved as version 4.")).toBeVisible();

  await founder.getByRole("button", { name: "Approve version 3" }).click();
  await expect(
    founder.getByText("The draft changed since you opened it. Reload to see the latest version."),
  ).toBeVisible();
  await founder.reload();
  await expect(founder.getByRole("article", { name: "Post text" })).toContainText("three whole days");
  await founder.getByRole("button", { name: "Approve version 4" }).click();
  await expect(founder.getByRole("heading", { name: "You approved version 4" })).toBeVisible();
});

test("a founder's rewrite request adds a version, keeps the old ones and withdraws the approval", async () => {
  await founder.reload();
  await founder.getByLabel("What should the rewrite do differently?").fill("Shorter, open with the van");
  await founder.getByRole("button", { name: "Ask for a rewrite" }).click();
  await expect(founder.getByText(/^Rewriting\./)).toBeVisible();
  await expect(founder.getByText("Version 5", { exact: true })).toBeVisible({ timeout: 20_000 });
  await expect(founder.getByRole("article", { name: "Post text" })).toContainText("Take two.");
  await expect(founder.getByText("ready for your review", { exact: true })).toBeVisible();
  await expect(founder.getByRole("list", { name: "Rewrite requests" })).toContainText("done");

  await founder.getByRole("link", { name: /^v2/ }).click();
  await expect(founder.getByText("earlier version")).toBeVisible();
  await expect(founder.getByRole("article", { name: "Post text" })).toContainText(STORY);

  await admin.reload();
  await expect(admin.getByRole("list", { name: "Approvals" }).locator(":scope > li").first()).toContainText(
    "Withdrawn: material edit",
  );
  await expect(admin.getByRole("list", { name: "Rewrite requests" })).toContainText("Shorter, open with the van");
});

test("the founder asks for changes; the admin sees it with their note", async () => {
  await founder.goto(founderPath());
  await founder.getByLabel("What should change?").fill("Too long, and keep my story");
  await founder.getByRole("button", { name: "Request changes" }).click();
  await expect(founder.getByText("changes requested", { exact: true })).toBeVisible();
  await expect(founder.getByRole("button", { name: /^Approve/ })).toHaveCount(0);

  await admin.reload();
  await expect(admin.getByText("changes requested", { exact: true })).toBeVisible();
  await expect(admin.getByRole("list", { name: "Comments" })).toContainText("Too long, and keep my story");
});

test("another founder can't reach the draft, in the app or through the API", async ({ browser }) => {
  const cto = await (await browser.newContext()).newPage();
  await signInWithCode(cto, "local-cto@autograff.ai");
  await expect(cto).toHaveURL(/\/dashboard$/);
  expect((await cto.goto(founderPath()))?.status()).toBe(404);
  await cto.goto("/drafts");
  await expect(cto.getByText("Nothing to review yet.")).toBeVisible();

  const draftId = draftPath.split("/").pop()!;
  const call = async (page: Page, fn: string, args: Record<string, unknown>) =>
    fetch(`${SUPABASE_URL}/rest/v1/rpc/${fn}`, {
      method: "POST",
      headers: {
        apikey: PUBLISHABLE_KEY,
        Authorization: `Bearer ${await accessTokenFrom(page)}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(args),
    });
  const versions = await call(cto, "founder_draft_versions", { p_draft_id: draftId });
  expect(await versions.json()).toEqual([]);
  const comment = await call(cto, "add_comment", {
    p_draft_id: draftId,
    p_body: "hi",
    p_quote: null,
    p_visibility: "shared",
  });
  expect(comment.ok).toBe(false);

  // The owner, through the API, gets no rationale and can't read the tables directly.
  const own = (await (await call(founder, "founder_draft_versions", { p_draft_id: draftId })).json()) as object[];
  expect(own.length).toBe(5);
  expect(own.every((v) => !("rationale" in v))).toBe(true);
  const table = await fetch(`${SUPABASE_URL}/rest/v1/draft_versions?select=rationale`, {
    headers: { apikey: PUBLISHABLE_KEY, Authorization: `Bearer ${await accessTokenFrom(founder)}` },
  });
  expect(await table.json()).toEqual([]);
  const internal = await fetch(`${SUPABASE_URL}/rest/v1/comments?select=body`, {
    headers: { apikey: PUBLISHABLE_KEY, Authorization: `Bearer ${await accessTokenFrom(founder)}` },
  });
  expect(await internal.json()).toEqual([]);
});

test("no page violated the Content Security Policy", () => {
  expect(cspViolations).toEqual([]);
});
