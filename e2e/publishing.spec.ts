import { execFileSync } from "node:child_process";
import { expect, test, type Page } from "@playwright/test";
import { SUPABASE_URL, accessTokenFrom, signInAdmin, signInWithCode } from "./helpers";

// Phase 9 acceptance criteria: schedule → copy → record, against the fake AI.
test.describe.configure({ mode: "serial" });

const ADMIN = "local-admin@autograff.ai";
const MONTH = "2026-11";
const PLACEHOLDER = "[FOUNDER TO SUPPLY: a time a repair status surprise cost you a day]";
const PUBLISHABLE_KEY = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? "";
const mfa = { secret: "" };
let admin: Page;
let founder: Page;
let draftPath = "";
let otherDraftId = "";
const cspViolations: string[] = [];

const watchCsp = (page: Page) =>
  page.on("console", (message) => {
    if (/Content Security Policy|Refused to (execute|load|apply)/i.test(message.text()))
      cspViolations.push(message.text());
  });

test.beforeAll(async ({ browser }) => {
  // Setup takes a draft through review to approval.
  test.setTimeout(180_000);
  execFileSync("npx", ["supabase", "db", "reset"], { stdio: "ignore" });
  // The admin's browser may use the clipboard, so the copied text can be read back.
  admin = await (await browser.newContext({ permissions: ["clipboard-read", "clipboard-write"] })).newPage();
  founder = await (await browser.newContext()).newPage();
  watchCsp(admin);
  watchCsp(founder);
  await signInAdmin(admin, ADMIN, mfa);
  await signInWithCode(founder, "local-ceo@autograff.ai");
  await expect(founder).toHaveURL(/\/dashboard$/);

  // Slots for the month, two concepts, and a draft of each.
  await admin.goto(`/admin/calendar?month=${MONTH}`);
  await admin.getByRole("button", { name: "Plan slots for November 2026" }).click();
  await expect(admin.getByRole("table", { name: "Slots" })).toContainText("Local CEO");
  await admin.goto(`/admin/concepts?month=${MONTH}`);
  const section = admin.getByRole("region", { name: "Concepts for Local CEO" });
  await section.getByLabel("Concepts for Local CEO").selectOption("2");
  await section.getByRole("button", { name: "Generate concepts" }).click();
  const cards = admin.getByRole("list", { name: "Local CEO's concepts" }).locator(":scope > li");
  await expect(cards).toHaveCount(2, { timeout: 20_000 });
  for (const angle of ["angle 2", "angle 1"]) {
    const card = cards.filter({ hasText: angle });
    await card.getByRole("button", { name: "Select" }).click();
    await card.getByRole("button", { name: "Write a draft" }).click();
    await expect(card.getByRole("link", { name: "Draft 1" })).toBeVisible({ timeout: 20_000 });
    if (angle === "angle 2") {
      await card.getByRole("link", { name: "Draft 1" }).click();
      await expect(admin).toHaveURL(/\/admin\/drafts\/[0-9a-f-]{36}$/);
      otherDraftId = new URL(admin.url()).pathname.split("/").pop()!;
      await admin.goto(`/admin/concepts?month=${MONTH}`);
    }
  }
  await cards.filter({ hasText: "angle 1" }).getByRole("link", { name: "Draft 1" }).click();
  await expect(admin).toHaveURL(/\/admin\/drafts\/[0-9a-f-]{36}$/);
  draftPath = new URL(admin.url()).pathname;

  // Through review to the founder's approval: share, fill the placeholder, resolve the claim, approve.
  await admin.getByRole("button", { name: "Share with the founder" }).click();
  await expect(admin.getByText("with founder", { exact: true })).toBeVisible();
  await founder.goto(draftPath.replace("/admin/drafts/", "/drafts/"));
  await founder.getByRole("button", { name: "Edit text" }).click();
  const body = founder.getByRole("textbox", { name: "Post text" });
  await body.fill((await body.inputValue()).replace(PLACEHOLDER, "Last spring a van sat ready for two days."));
  await founder.getByRole("button", { name: "Save as a new version" }).click();
  await expect(founder.getByText("Saved as version 2.")).toBeVisible();
  await admin.reload();
  const claim = admin
    .getByRole("list", { name: "Review flags" })
    .locator(":scope > li")
    .filter({ hasText: "isn't backed by an approved fact" });
  await claim.getByLabel("Reason").fill("Confirmed with the founder's ops data");
  await claim.getByRole("button", { name: "Resolve" }).click();
  await expect(claim).toContainText("resolved");
  await founder.reload();
  await founder.getByRole("button", { name: "Approve version 2" }).click();
  await expect(founder.getByRole("heading", { name: "You approved version 2" })).toBeVisible();
});

test("criterion 1: an unapproved draft has no publishing controls, and the API refuses it with an admin token", async () => {
  await admin.goto(`/admin/drafts/${otherDraftId}`);
  await expect(admin.getByRole("heading", { name: "Publishing" })).toHaveCount(0);
  const token = await accessTokenFrom(admin);
  const call = (fn: string, args: Record<string, unknown>) =>
    fetch(`${SUPABASE_URL}/rest/v1/rpc/${fn}`, {
      method: "POST",
      headers: { apikey: PUBLISHABLE_KEY, Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(args),
    });
  for (const [fn, args] of [
    ["schedule_draft", { p_draft_id: otherDraftId, p_scheduled_for: "2026-11-20T17:00:00Z", p_slot_id: null }],
    ["approved_text", { p_draft_id: otherDraftId }],
    [
      "record_publication",
      {
        p_draft_id: otherDraftId,
        p_published_at: new Date().toISOString(),
        p_linkedin_url: "https://www.linkedin.com/posts/x",
        p_published_text: null,
      },
    ],
  ] as const) {
    const response = await call(fn, args);
    expect(response.ok, fn).toBe(false);
    expect(((await response.json()) as { message: string }).message, fn).toMatch(/only an approved draft/);
  }
});

test("scheduling into a slot, and rescheduling, keep the approval (criterion 2)", async () => {
  await admin.goto(draftPath);
  await expect(admin.getByText("approved", { exact: true })).toBeVisible();
  const slot = admin.getByLabel("Calendar slot (optional)");
  const options = await slot.locator("option").allTextContents();
  const first = options[1];
  const second = options[2];
  await slot.selectOption({ label: first });
  // The slot's day, 9:00 in the founder's time zone.
  const firstDay = new Date(`${first.replace(/^\w+, /, "")}, 2026 12:00 UTC`);
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  await admin.getByLabel("Publish on").fill(`${iso(firstDay)}T09:00`);
  await admin.getByRole("button", { name: "Schedule" }).click();
  await expect(admin.getByText("scheduled", { exact: true })).toBeVisible();
  await expect(admin.getByRole("heading", { name: /^Scheduled for / })).toContainText("9:00 AM");

  const secondDay = new Date(`${second.replace(/^\w+, /, "")}, 2026 12:00 UTC`);
  await admin.getByLabel("Calendar slot (optional)").selectOption({ label: second });
  await admin.getByLabel("Publish on").fill(`${iso(secondDay)}T10:30`);
  await admin.getByRole("button", { name: "Reschedule" }).click();
  await expect(admin.getByRole("heading", { name: /^Scheduled for / })).toContainText("10:30 AM");
  const approval = admin.getByRole("list", { name: "Approvals" }).locator(":scope > li").first();
  await expect(approval).toContainText("Approved v2");
  await expect(approval).toContainText("valid");

  await admin.goto(`/admin/calendar?month=${MONTH}`);
  await expect(
    admin.getByRole("table", { name: "Slots" }).getByRole("row").filter({ hasText: "scheduled" }),
  ).toHaveCount(1);
  await founder.goto("/drafts");
  await expect(founder.getByRole("table", { name: "Your drafts" })).toContainText("10:30 AM");
});

test("criterion 3: the copied text equals the approved version", async () => {
  await admin.goto(draftPath);
  await admin.getByRole("button", { name: "Copy approved text" }).click();
  await expect(admin.getByText("Copied the approved text.")).toBeVisible();
  const copied = await admin.evaluate(() => navigator.clipboard.readText());
  // The version the founder approved, as the founder sees it.
  await founder.goto(draftPath.replace("/admin/drafts/", "/drafts/"));
  const approved = await founder.getByRole("article", { name: "Post text" }).textContent();
  // Browsers submit a textarea's line breaks as CRLF and display them as LF: equal after normalization.
  expect(copied.replace(/\r\n?/g, "\n")).toBe(approved);
  // And byte for byte what the server holds as the approved text.
  const server = await fetch(`${SUPABASE_URL}/rest/v1/rpc/approved_text`, {
    method: "POST",
    headers: {
      apikey: PUBLISHABLE_KEY,
      Authorization: `Bearer ${await accessTokenFrom(admin)}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ p_draft_id: draftPath.split("/").pop() }),
  });
  expect(copied).toBe(await server.json());
  expect(copied).toContain("Last spring a van sat ready for two days.");
  expect(copied).not.toContain("FOUNDER TO SUPPLY");
  await expect(admin.getByLabel("Text to post")).toHaveText(copied.replace(/\r\n?/g, "\n"));
});

test("criterion 4: recording a differing text shows the diff; criterion 5: a second record is refused", async () => {
  await admin.getByLabel("LinkedIn link").fill("https://www.linkedin.com/posts/local-ceo_repair-delays-1");
  await admin.getByLabel("Posted exactly as approved").uncheck();
  const copied = await admin.evaluate(() => navigator.clipboard.readText());
  await admin.getByLabel("Text as posted").fill(copied.replace("two days", "two whole days"));
  await admin.getByRole("button", { name: "Record publication" }).click();
  await expect(admin.getByText("published", { exact: true })).toBeVisible();
  const publication = admin.getByLabel("Publication");
  await expect(publication.getByRole("link", { name: "View on LinkedIn" })).toHaveAttribute(
    "href",
    "https://www.linkedin.com/posts/local-ceo_repair-delays-1",
  );
  await expect(publication).toContainText("posted text differs from the approved version");
  await expect(publication.getByLabel("Changes").locator("ins")).toContainText(["whole"]);
  // Published drafts have no publishing controls left: a second record isn't offered, and the API refuses it.
  await expect(admin.getByRole("button", { name: "Record publication" })).toHaveCount(0);
  const response = await fetch(`${SUPABASE_URL}/rest/v1/rpc/record_publication`, {
    method: "POST",
    headers: {
      apikey: PUBLISHABLE_KEY,
      Authorization: `Bearer ${await accessTokenFrom(admin)}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      p_draft_id: draftPath.split("/").pop(),
      p_published_at: new Date().toISOString(),
      p_linkedin_url: "https://www.linkedin.com/posts/local-ceo_again",
      p_published_text: null,
    }),
  });
  expect(response.ok).toBe(false);

  await founder.goto("/drafts");
  await expect(founder.getByRole("link", { name: /^Published / })).toHaveAttribute(
    "href",
    "https://www.linkedin.com/posts/local-ceo_repair-delays-1",
  );
});

test("metrics are entered by hand, an outside post is recorded, and the reports add them up", async () => {
  const form = admin.getByRole("form", { name: "Add metrics" });
  await form.getByLabel("Impressions").fill("1,200");
  await form.getByLabel("Reactions").fill("4.5");
  await form.getByRole("button", { name: "Save metrics as of now" }).click();
  await expect(form.getByText("reactions must be a whole number.")).toBeVisible();
  await form.getByLabel("Reactions").fill("45");
  await form.getByRole("button", { name: "Save metrics as of now" }).click();
  await expect(form.getByText("Metrics saved.")).toBeVisible();
  await admin.reload();
  await expect(admin.getByLabel("Publication")).toContainText("Impressions 1,200 · Reactions 45");

  await admin.goto("/admin/publications");
  await admin.getByRole("combobox", { name: "Founder", exact: true }).selectOption({ label: "Local CTO (CTO)" });
  await admin.getByLabel("LinkedIn link").fill("https://www.linkedin.com/posts/local-cto_own-post");
  await admin.getByLabel("Text as posted").fill("A post the CTO wrote on their own.");
  await admin.getByRole("button", { name: "Record external post" }).click();
  await expect(admin.getByText("Recorded as published outside the studio.")).toBeVisible();
  await admin.reload();
  const published = admin.getByRole("region", { name: "Published" });
  await expect(published.getByRole("article")).toHaveCount(2);
  await expect(published).toContainText("Posted outside the studio");
  await expect(published).toContainText("text differs from approved");

  await admin.goto("/admin/reports");
  await expect(
    admin.getByRole("table", { name: "Published against cadence" }).getByRole("row").filter({ hasText: "Local CEO" }),
  ).toContainText("1");
  const themes = admin.getByRole("table", { name: "Theme" });
  await expect(themes.getByRole("row").filter({ hasText: "Operational uncertainty in vehicle repair" })).toContainText(
    "1,200",
  );
  await expect(themes.getByRole("row").filter({ hasText: "Outside the studio" })).toContainText("1");
});

test("no page violated the Content Security Policy", () => {
  expect(cspViolations).toEqual([]);
});
