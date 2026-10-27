import { expect, test, type Page } from "@playwright/test";
import { resetDatabase, signInAdmin, signInWithCode } from "./helpers";

// Phase 4b acceptance criteria, against the fake AI provider (no real calls).
test.describe.configure({ mode: "serial" });

const ADMIN = "local-admin@autograff.ai";
const MONTH = "2026-11";
const mfa = { secret: "" };
let admin: Page;
let firstDraftUrl = "";
const cspViolations: string[] = [];

const ceoSection = () => admin.getByRole("region", { name: "Concepts for Local CEO" });
const ceoCards = () => admin.getByRole("list", { name: "Local CEO's concepts" }).locator(":scope > li");
const flags = () => admin.getByRole("list", { name: "Review flags" }).locator(":scope > li");

test.beforeAll(async ({ browser }) => {
  await resetDatabase();
  admin = await (await browser.newContext()).newPage();
  admin.on("console", (message) => {
    if (/Content Security Policy|Refused to (execute|load|apply)/i.test(message.text()))
      cspViolations.push(message.text());
  });
  await signInAdmin(admin, ADMIN, mfa);
  // Two concepts to work from; the first needs a personal story.
  await admin.goto(`/admin/concepts?month=${MONTH}`);
  await ceoSection().getByLabel("Concepts for Local CEO").selectOption("2");
  await ceoSection().getByRole("button", { name: "Generate concepts" }).click();
  await expect(ceoCards()).toHaveCount(2, { timeout: 20_000 });
});

test("a draft is written from a selected concept, with placeholder and claim flags kept out of the post", async () => {
  const first = ceoCards().filter({ hasText: "angle 1" });
  await first.getByRole("button", { name: "Select" }).click();
  await first.getByRole("button", { name: "Write a draft" }).click();
  await expect(first.getByText(/^Generating\. This run can cost up to \$/)).toBeVisible();
  await expect(first.getByRole("link", { name: "Draft 1" })).toBeVisible({ timeout: 20_000 });
  await first.getByRole("link", { name: "Draft 1" }).click();
  await expect(admin).toHaveURL(/\/admin\/drafts\/[0-9a-f-]{36}$/);
  firstDraftUrl = admin.url();

  const post = admin.getByRole("article", { name: "Post text" });
  await expect(post).toContainText("[FOUNDER TO SUPPLY: a time a repair status surprise cost you a day]");
  // Criterion 3: no rationale, flags or sources in the post itself.
  await expect(post).not.toContainText("Rationale");
  await expect(post).not.toContainText("Fake rationale");
  await expect(admin.getByText("Fake rationale: leads with the hook, then the argument.")).toBeVisible();

  // Criterion 4: the placeholder carries a blocking flag that can't be resolved by hand.
  const placeholder = flags().filter({ hasText: "Founder to supply: a time a repair status surprise cost you a day" });
  await expect(placeholder).toContainText("blocking");
  await expect(placeholder.getByRole("button", { name: "Resolve" })).toHaveCount(0);
  await expect(placeholder).toContainText("Clears when the placeholder is replaced in the text.");

  // Criterion 5: a factual claim with no approved fact behind it is flagged.
  await expect(flags().filter({ hasText: "isn't backed by an approved fact" })).toContainText("blocking");
  await expect(admin.getByRole("table", { name: "Claims" })).toContainText("unsupported");

  await admin.goto("/admin/ai");
  await expect(admin.getByRole("table", { name: "Runs" }).getByRole("row").nth(1)).toContainText("Draft");
  await expect(admin.getByRole("table", { name: "Runs" }).getByRole("row").nth(1)).toContainText("draft v2");
});

test("a second draft of the same argument gets a repetition warning; overriding it needs a reason", async () => {
  await admin.goto(`/admin/concepts?month=${MONTH}`);
  const first = ceoCards().filter({ hasText: "angle 1" });
  await first.getByRole("button", { name: "Write another draft" }).click();
  await expect(first.getByRole("link", { name: "Draft 2" })).toBeVisible({ timeout: 20_000 });
  await first.getByRole("link", { name: "Draft 2" }).click();

  const repetition = flags().filter({ hasText: "Overlaps with a draft" });
  await expect(repetition).toContainText("warning");
  await repetition.getByLabel("Reason").fill("ok");
  await repetition.getByRole("button", { name: "Override" }).click();
  await expect(repetition.getByText("Give a reason (at least 5 characters).")).toBeVisible();
  await repetition.getByLabel("Reason").fill("A deliberate second angle on the same argument");
  await repetition.getByRole("button", { name: "Override" }).click();
  await expect(repetition).toContainText("overridden");
  await expect(repetition).toContainText("Reason: A deliberate second angle on the same argument");
});

test("editing the text creates a new version: the placeholder flag clears and the diff shows the change", async () => {
  await admin.goto(firstDraftUrl);
  await admin.getByRole("button", { name: "Edit text" }).click();
  const body = admin.getByRole("textbox", { name: "Post text" });
  const text = await body.inputValue();
  await body.fill(
    text.replace(
      "[FOUNDER TO SUPPLY: a time a repair status surprise cost you a day]",
      "Last spring a van sat ready for two days because nobody called.",
    ),
  );
  await admin.getByLabel("What changed (optional)").fill("Founder's story added");
  await admin.getByRole("button", { name: "Save as a new version" }).click();
  await expect(admin.getByText("Saved as version 2.")).toBeVisible();
  await admin.reload();

  await expect(admin.getByText("Version 2", { exact: true })).toBeVisible();
  await expect(flags().filter({ hasText: "Founder to supply" })).toHaveCount(0);
  // The claim is still in the text, so its flag carries over to the new version.
  const claim = flags().filter({ hasText: "isn't backed by an approved fact" });
  await expect(claim).toContainText("blocking");
  await claim.getByLabel("Reason").fill("Confirmed with the founder's ops data");
  await claim.getByRole("button", { name: "Resolve" }).click();
  await expect(claim).toContainText("resolved");

  // The diff is word by word, so a rewritten sentence shows as several marked pieces.
  const changes = admin.getByLabel("Changes");
  const added = (await changes.locator("ins").allTextContents()).join(" ");
  const removed = (await changes.locator("del").allTextContents()).join(" ");
  expect(added).toMatch(/spring.*van.*nobody called/);
  expect(removed).toContain("[FOUNDER TO SUPPLY:");
});

test("regenerating creates a new version and earlier versions stay readable", async () => {
  await admin.goto(firstDraftUrl);
  await admin.getByLabel("What should the new version do differently? (optional)").fill("Shorter");
  await admin.getByRole("button", { name: "Regenerate as a new version" }).click();
  await expect(admin.getByText("Version 3", { exact: true })).toBeVisible({ timeout: 20_000 });
  await expect(admin.getByRole("article", { name: "Post text" })).toContainText("Take two.");

  await admin.getByRole("link", { name: /^v2/ }).click();
  await expect(admin.getByText("read-only")).toBeVisible();
  await expect(admin.getByRole("article", { name: "Post text" })).toContainText(
    "Last spring a van sat ready for two days because nobody called.",
  );
  await expect(admin.getByRole("button", { name: "Edit text" })).toHaveCount(0);
});

test("drafts move through review, archive and rejection, and nothing else", async () => {
  await admin.goto(firstDraftUrl);
  await expect(admin.getByRole("button", { name: "Approve" })).toHaveCount(0);
  await admin.getByRole("button", { name: "Archive" }).click();
  await expect(admin.getByText("archived", { exact: true })).toBeVisible();
  await expect(admin.getByRole("button", { name: "Edit text" })).toHaveCount(0);
  await admin.getByRole("button", { name: "Restore to review" }).click();
  await expect(admin.getByText("in review", { exact: true })).toBeVisible();
  await admin.getByRole("button", { name: "Reject" }).click();
  await expect(admin.getByText("rejected", { exact: true })).toBeVisible();
  await expect(admin.getByRole("button", { name: "Restore to review" })).toHaveCount(0);

  await admin.goto(`/admin/drafts?month=${MONTH}`);
  await expect(admin.getByRole("table", { name: "Local CEO's drafts" }).getByRole("row")).toHaveCount(1);
});

test("founders cannot reach drafts", async ({ browser }) => {
  const founder = await (await browser.newContext()).newPage();
  await signInWithCode(founder, "local-ceo@autograff.ai");
  await expect(founder).toHaveURL(/\/dashboard$/);
  for (const path of ["/admin/drafts", firstDraftUrl.replace(/^https?:\/\/[^/]+/, "")]) {
    const response = await founder.goto(path);
    expect(response?.status(), path).toBe(404);
  }
});

test("no page violated the Content Security Policy", () => {
  expect(cspViolations).toEqual([]);
});
