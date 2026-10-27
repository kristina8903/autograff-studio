import { execFileSync } from "node:child_process";
import { expect, test, type Locator, type Page } from "@playwright/test";
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

/** The value next to a label in a definition list. */
const term = (scope: Locator, label: string) =>
  scope.getByRole("term").filter({ hasText: label }).locator("xpath=following-sibling::dd[1]");
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
  await expect(replenish.getByRole("heading", { name: "Top up November 2026" })).toBeVisible();
  // Ceiling 20 candidates, none in hand: a need of 20, capped at the batch of 5.
  await expect(term(replenish, "New concepts needed")).toHaveText("20");
  await replenish.getByRole("button", { name: "Top up: 5 new concepts…" }).click();
  await expect(replenish.getByText(/Ask the AI for 5 new concepts for Local CEO in November 2026\?/)).toBeVisible();
  // Cancelling asks for nothing.
  await replenish.getByRole("button", { name: "Cancel" }).click();
  await admin.goto(`/admin/concepts?month=${MONTH}`);
  await expect(admin.getByRole("list", { name: "Local CEO's concepts" })).toHaveText("No concepts yet.");

  await admin.goto(PIPELINE);
  await replenish.getByRole("button", { name: "Top up: 5 new concepts…" }).click();
  await replenish.getByRole("button", { name: "Confirm top-up" }).click();
  await expect(replenish.getByText(/^Asked for 5 concepts\./)).toBeVisible();
  await admin.goto(`/admin/concepts?month=${MONTH}`);
  await expect(admin.getByRole("list", { name: "Local CEO's concepts" }).locator(":scope > li")).toHaveCount(5, {
    timeout: 20_000,
  });

  // The proposals count as candidates in hand: the need drops by five.
  await admin.goto(PIPELINE);
  await expect(term(replenish, "Unused concepts")).toHaveText("5");
  await expect(term(replenish, "New concepts needed")).toHaveText("15");
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

test("the admin sets the batch sizes, and a top-up drafts selected concepts up to the draft batch", async () => {
  await admin.goto(PIPELINE);
  const sizes = admin.getByRole("form", { name: "Top-up batch sizes" });
  await sizes.getByLabel("New concepts per top-up").fill("4");
  await sizes.getByLabel("Drafts per top-up").fill("2");
  await sizes.getByRole("button", { name: "Save" }).click();
  await expect(sizes.getByText("Saved.")).toBeVisible();

  // Three of the CEO's concepts selected; the top-up drafts two of them.
  await admin.goto(`/admin/concepts?month=${MONTH}`);
  const cards = admin.getByRole("list", { name: "Local CEO's concepts" }).locator(":scope > li");
  for (const angle of ["angle 1", "angle 2", "angle 3"]) {
    const card = cards.filter({ hasText: angle });
    await card.getByRole("button", { name: "Select" }).click();
    await expect(card.getByRole("button", { name: "Unselect" })).toBeVisible();
  }
  await admin.goto(PIPELINE);
  const replenish = ceo().getByRole("region", { name: "Replenishment" });
  await expect(term(replenish, "Selected concepts waiting for a draft")).toHaveText("3");
  await replenish.getByRole("button", { name: "Top up: 4 new concepts + 2 drafts of selected concepts…" }).click();
  await expect(replenish.getByText(/4 new concepts and 2 drafts of selected concepts for Local CEO/)).toBeVisible();
  await replenish.getByRole("button", { name: "Confirm top-up" }).click();
  await expect(replenish.getByText(/^Asked for 4 concepts and 2 drafts\./)).toBeVisible();

  await admin.goto(`/admin/concepts?month=${MONTH}`);
  await expect(cards).toHaveCount(9, { timeout: 20_000 });
  await expect(cards.getByRole("link", { name: "Draft 1" })).toHaveCount(2, { timeout: 20_000 });
  await admin.goto(PIPELINE);
  await expect(term(replenish, "Selected concepts waiting for a draft")).toHaveText("1");
  const pipeline = ceo().getByRole("region", { name: "Pipeline" });
  await expect(term(pipeline, "Awaiting admin review")).toHaveText("2");
  // Drafts are pipeline, never supply.
  await expect(term(ceo().getByRole("region", { name: "Supply" }), "Usable buffer")).toHaveText("0");
});

test("replenishment targets a month inside the period shown", async () => {
  // November has the next open slot, but December alone is shown: December is replenished.
  await admin.goto("/admin/pipeline?month=2026-12&span=1");
  await expect(
    ceo().getByRole("region", { name: "Replenishment" }).getByRole("heading", { name: "Top up December 2026" }),
  ).toBeVisible();
});

test("no control on the page approves, schedules or publishes", async () => {
  await admin.goto(PIPELINE);
  const labels = await admin.getByRole("main").getByRole("button").allTextContents();
  expect(labels.length).toBeGreaterThan(0);
  // Top-ups ask for concepts and drafts; Save sets the batch sizes.
  for (const label of labels) expect(label).toMatch(/^(Top up: .+…|Save)$/);
});

test("the diversity report shows the month's drafts by fingerprint", async () => {
  await admin.goto("/admin/pipeline/diversity?month=2026-12");
  await expect(admin.getByText("No live drafts for December 2026 yet.")).toBeVisible();
  // November holds the two drafts the top-up wrote.
  await admin.goto(`/admin/pipeline/diversity?month=${MONTH}`);
  for (const table of ["Topics", "Formats", "Hooks", "Audiences", "Product mentions", "Calls to action"])
    await expect(
      admin.getByRole("table", { name: table }).getByRole("columnheader", { name: "All (2)" }),
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
