import { execFileSync } from "node:child_process";
import { expect, test, type Page } from "@playwright/test";
import { signInAdmin } from "./helpers";

// Phase 8: the dashboard shows a shortfall, and the admin generates a
// replenishment batch through the fake AI provider (no real calls).
test.describe.configure({ mode: "serial" });

const ADMIN = "local-admin@autograff.ai";
const MONTH = "2026-11"; // the seeded brief
const PIPELINE = `/admin/pipeline?month=${MONTH}&span=1`;
const mfa = { secret: "" };
let admin: Page;
const cspViolations: string[] = [];

const ceo = () => admin.getByRole("region", { name: "Pipeline for Local CEO" });
const cto = () => admin.getByRole("region", { name: "Pipeline for Local CTO" });

test.beforeAll(async ({ browser }) => {
  test.setTimeout(120_000);
  execFileSync("npx", ["supabase", "db", "reset"], { stdio: "ignore" });
  admin = await (await browser.newContext()).newPage();
  admin.on("console", (message) => {
    if (/Content Security Policy|Refused to (execute|load|apply)/i.test(message.text()))
      cspViolations.push(message.text());
  });
  await signInAdmin(admin, ADMIN, mfa);
  await admin.goto(`/admin/calendar?month=${MONTH}`);
  await admin.getByRole("button", { name: "Plan slots for November 2026" }).click();
  await expect(admin.getByRole("table", { name: "Slots" })).toContainText("Local CEO");
});

test("the dashboard shows a shortfall when no approved content is in hand", async () => {
  await admin.goto(PIPELINE);
  const row = admin.getByRole("table", { name: "Coverage" }).getByRole("row").filter({ hasText: "Local CEO" });
  await expect(row.getByText("Short", { exact: true })).toBeVisible();
  await expect(row.getByText("Buffer low")).toBeVisible();
  await expect(ceo().getByText("0 approved posts in hand, below the threshold of 2.")).toBeVisible();
  // Nothing in hand: the whole month is a gap.
  const supply = ceo().getByRole("region", { name: "Supply" });
  const required = await supply
    .getByRole("term")
    .filter({ hasText: "Slots required" })
    .locator("xpath=following-sibling::dd[1]")
    .textContent();
  expect(Number(required)).toBeGreaterThan(0);
  await expect(
    supply.getByRole("term").filter({ hasText: "Supply gap" }).locator("xpath=following-sibling::dd[1]"),
  ).toHaveText(required!);
  await expect(
    supply.getByRole("term").filter({ hasText: "Usable buffer" }).locator("xpath=following-sibling::dd[1]"),
  ).toHaveText("0");
});

test("replenishment proposes at most the batch size and runs only after confirmation", async () => {
  await admin.goto(PIPELINE);
  const replenish = ceo().getByRole("region", { name: "Replenishment" });
  await expect(replenish.getByRole("heading", { name: "Replenish November 2026" })).toBeVisible();
  // Ceiling 20 candidates, none in hand: a need of 20, capped at the batch of 5.
  await expect(
    replenish.getByRole("term").filter({ hasText: "Need" }).locator("xpath=following-sibling::dd[1]"),
  ).toHaveText("20");
  await replenish.getByRole("button", { name: "Generate 5 concepts…" }).click();
  await expect(replenish.getByText(/Ask the AI for 5 new concepts for Local CEO in November 2026\?/)).toBeVisible();
  // Cancelling asks for nothing.
  await replenish.getByRole("button", { name: "Cancel" }).click();
  await admin.goto(`/admin/concepts?month=${MONTH}`);
  await expect(admin.getByRole("list", { name: "Local CEO's concepts" })).toHaveText("No concepts yet.");

  await admin.goto(PIPELINE);
  await replenish.getByRole("button", { name: "Generate 5 concepts…" }).click();
  await replenish.getByRole("button", { name: "Confirm: generate 5" }).click();
  await expect(replenish.getByText(/^Generating\. This run can cost up to \$/)).toBeVisible();
  await admin.goto(`/admin/concepts?month=${MONTH}`);
  await expect(admin.getByRole("list", { name: "Local CEO's concepts" }).locator(":scope > li")).toHaveCount(5, {
    timeout: 20_000,
  });

  // The proposals count as candidates in hand: the need drops by five.
  await admin.goto(PIPELINE);
  await expect(
    replenish.getByRole("term").filter({ hasText: "Unused concepts" }).locator("xpath=following-sibling::dd[1]"),
  ).toHaveText("5");
  await expect(
    replenish.getByRole("term").filter({ hasText: "Need" }).locator("xpath=following-sibling::dd[1]"),
  ).toHaveText("15");
});

test("nothing is offered when supply is sufficient", async () => {
  // The CTO's ceiling is 6 candidates; six concepts meet it.
  await admin.goto(`/admin/concepts?month=${MONTH}`);
  const section = admin.getByRole("region", { name: "Concepts for Local CTO" });
  await section.getByLabel("Concepts for Local CTO").selectOption("6");
  await section.getByRole("button", { name: "Generate concepts" }).click();
  await expect(admin.getByRole("list", { name: "Local CTO's concepts" }).locator(":scope > li")).toHaveCount(6, {
    timeout: 20_000,
  });
  await admin.goto(PIPELINE);
  const replenish = cto().getByRole("region", { name: "Replenishment" });
  await expect(replenish.getByText("Supply is sufficient for November 2026. Nothing to generate.")).toBeVisible();
  await expect(replenish.getByRole("button")).toHaveCount(0);
});

test("replenishment targets a month inside the period shown", async () => {
  // November has the next open slot, but December alone is shown: December is replenished.
  await admin.goto("/admin/pipeline?month=2026-12&span=1");
  await expect(
    ceo().getByRole("region", { name: "Replenishment" }).getByRole("heading", { name: "Replenish December 2026" }),
  ).toBeVisible();
});

test("no control on the page approves, schedules or publishes", async () => {
  await admin.goto(PIPELINE);
  const labels = await admin.getByRole("main").getByRole("button").allTextContents();
  expect(labels.length).toBeGreaterThan(0);
  for (const label of labels) expect(label).toMatch(/^Generate \d+ concepts?…$/);
});

test("the diversity report shows the month's drafts by fingerprint", async () => {
  await admin.goto(`/admin/pipeline/diversity?month=${MONTH}`);
  await expect(admin.getByText("No live drafts for November 2026 yet.")).toBeVisible();
  await admin.goto(`/admin/concepts?month=${MONTH}`);
  // Selecting reorders the list, so the card is found by its title.
  const card = admin
    .getByRole("list", { name: "Local CEO's concepts" })
    .locator(":scope > li")
    .filter({ hasText: "angle 1" });
  await card.getByRole("button", { name: "Select" }).click();
  await card.getByRole("button", { name: "Write a draft" }).click();
  await expect(card.getByRole("link", { name: "Draft 1" })).toBeVisible({ timeout: 20_000 });
  await admin.goto(`/admin/pipeline/diversity?month=${MONTH}`);
  for (const table of ["Topics", "Formats", "Hooks", "Audiences", "Product mentions", "Calls to action"])
    await expect(
      admin.getByRole("table", { name: table }).getByRole("columnheader", { name: "All (1)" }),
    ).toBeVisible();
});

test("the combined calendar filters by state and links each founder's coverage", async () => {
  await admin.goto(`/admin/calendar?month=${MONTH}&show=news`);
  const slots = admin.getByRole("table", { name: "Slots" });
  await expect(slots.getByRole("row").filter({ hasText: "Kept for news" }).first()).toBeVisible();
  await expect(slots.getByRole("row").filter({ hasText: "Planned" })).toHaveCount(0);
  await admin.getByRole("navigation", { name: "Filter by state" }).getByRole("link", { name: "Skipped" }).click();
  await expect(admin.getByText("No slots match this filter.")).toBeVisible();
  const coverage = admin.getByRole("table", { name: "Coverage" }).getByRole("row").filter({ hasText: "Local CEO" });
  await coverage.getByRole("link").filter({ hasText: "Short" }).click();
  await expect(admin).toHaveURL(/\/admin\/pipeline\?month=2026-11&span=1#founder-/);
});

test("no Content Security Policy violations", () => {
  expect(cspViolations).toEqual([]);
});
