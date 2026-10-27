import { expect, test, type Page } from "@playwright/test";
import { generateSlots, monthTargets, type CadenceRule } from "../lib/domain/cadence";
import { addMonths, localToday, monthLabel, monthOf } from "../lib/domain/dates";
import { resetDatabase, signInAdmin, signInWithCode } from "./helpers";

// Phase 2 acceptance criteria (docs/PHASES.md) as one ordered story.
test.describe.configure({ mode: "serial" });

const ADMIN = "local-admin@autograff.ai";
const CEO_FOUNDER = "00000000-0000-4000-8000-0000000000f1";
const mfa = { secret: "" };
let admin: Page;

// Seeded founders are in America/Los_Angeles.
const today = localToday("America/Los_Angeles");
const next = addMonths(monthOf(today), 1);
const ceoRule: CadenceRule = {
  id: "seed",
  effectiveFrom: "2026-01-01",
  effectiveTo: null,
  period: "week",
  minPosts: 2,
  maxPosts: 3,
  weeklyPattern: null,
  publishingDays: [2, 3, 4],
  reservedTimelySlotsPerMonth: 1,
};

test.beforeAll(async ({ browser }) => {
  // Fresh seed: this file must not depend on what foundation.spec.ts changed.
  await resetDatabase();
  admin = await (await browser.newContext()).newPage();
  await signInAdmin(admin, ADMIN, mfa);
});

test("saving a brief creates a new version and earlier versions stay readable", async () => {
  await admin.getByRole("link", { name: "Briefs" }).click();
  await admin.getByRole("table", { name: "Briefs" }).getByRole("link", { name: "November 2026" }).click();
  await expect(admin.getByText("Current version: v1.")).toBeVisible();
  await admin.getByLabel("Theme", { exact: true }).fill("Operational uncertainty, sharpened");
  await admin.getByLabel("Topics to avoid").fill("Naming competitors\nPricing debates");
  await admin.getByLabel("What changed").fill("Sharper theme");
  await admin.getByRole("button", { name: "Save as version 2" }).click();
  await expect(admin.getByText("Saved as version 2.")).toBeVisible();

  await admin.getByRole("link", { name: /^v1/ }).click();
  await expect(admin.getByText("Operational uncertainty in vehicle repair")).toBeVisible();
  await expect(admin.getByText("read-only")).toBeVisible();

  await admin.getByRole("link", { name: /^v2/ }).click();
  const changes = admin.getByRole("region", { name: "Changes from the previous version" });
  await expect(changes).toContainText("Theme");
  await expect(changes).toContainText("Operational uncertainty, sharpened");
  await expect(changes).toContainText("Pricing debates");
});

test("each founder's cadence shows the slots it requires", async () => {
  await admin.goto(`/admin/founders/${CEO_FOUNDER}`);
  await expect(admin.getByText("2–3 posts a week on Tue, Wed, Thu")).toBeVisible();
  const t = monthTargets([ceoRule], next);
  await expect(admin.getByLabel("Slots required")).toContainText(`${monthLabel(next)}: ${t.target} slots`);
});

test("planning creates the slots, is idempotent, and leaves skipped slots alone", async () => {
  await admin.goto(`/admin/calendar?month=${next}`);
  await admin.getByRole("button", { name: `Plan slots for ${monthLabel(next)}` }).click();
  await expect(admin.getByText(/Planned: \d+ slot\(s\) added/)).toBeVisible();

  const expected = generateSlots([ceoRule], next).length;
  const ceoRow = admin.getByRole("table", { name: "Coverage" }).getByRole("row", { name: /Local CEO/ });
  await expect(ceoRow.getByRole("cell").nth(2)).toHaveText(String(expected));

  const firstSlot = admin
    .getByRole("table", { name: "Slots" })
    .getByRole("row", { name: /Local CEO/ })
    .first();
  await firstSlot.getByRole("button", { name: "Skip" }).click();
  await expect(ceoRow.getByRole("cell").nth(4)).toHaveText("1");

  await admin.getByRole("button", { name: `Plan slots for ${monthLabel(next)}` }).click();
  await expect(admin.getByText("Already up to date.")).toBeVisible();
  await expect(ceoRow.getByRole("cell").nth(4)).toHaveText("1");
});

test("a one-off slot can be added", async () => {
  await admin.getByRole("combobox", { name: /^Founder/ }).selectOption({ label: "Local CTO (CTO)" });
  await admin.getByLabel("Date", { exact: true }).fill(`${next}-15`);
  await admin.getByLabel("Note (optional)").fill("Conference talk");
  await admin.getByRole("button", { name: "Add slot" }).click();
  await expect(admin.getByRole("table", { name: "Slots" })).toContainText("Conference talk");
});

test("changing a cadence re-plans only from its start date", async () => {
  await admin.goto(`/admin/founders/${CEO_FOUNDER}`);
  await admin.getByLabel("Maximum posts").fill("2");
  await admin.getByLabel("Starts on").fill(`${next}-01`);
  await admin.getByLabel("Reason for the change").fill("Lighter month");
  await admin.getByRole("button", { name: "Save cadence" }).click();
  await expect(admin.getByText(`Cadence saved from ${next}-01. Re-planned 1 month(s).`)).toBeVisible();
  await expect(admin.getByText("2 posts a week on Tue, Wed, Thu")).toBeVisible();

  await admin.goto(`/admin/calendar?month=${next}`);
  const lighter: CadenceRule = { ...ceoRule, id: "new", effectiveFrom: `${next}-01`, maxPosts: 2 };
  const newPlan = generateSlots([lighter], next).map((s) => s.date);
  const skippedDate = generateSlots([ceoRule], next)[0].date; // skipped in the previous test
  // Open slots now follow the new rule; the skipped slot stays skipped and keeps its date.
  const expectedPlanned = newPlan.length - (newPlan.includes(skippedDate) ? 1 : 0);
  const ceoRow = admin.getByRole("table", { name: "Coverage" }).getByRole("row", { name: /Local CEO/ });
  await expect(ceoRow.getByRole("cell").nth(2)).toHaveText(String(expectedPlanned));
  await expect(ceoRow.getByRole("cell").nth(4)).toHaveText("1");
});

test("a founder sees their own upcoming slots, the brief's theme and only their own emphasis", async ({ browser }) => {
  await admin.goto(`/admin/briefs/${next}`);
  await admin.getByLabel("Theme", { exact: true }).fill("Repair shops under pressure");
  await admin.getByLabel("Local CEO (CEO)").fill("CEO angle: customer trust");
  await admin.getByLabel("Local COO (COO)").fill("COO angle: shop-floor throughput");
  await admin.getByLabel("Approved facts and messaging").fill("Internal fact the founder must not see");
  await admin.getByRole("button", { name: /^Save as version/ }).click();
  await expect(admin.getByText(/^Saved as version/)).toBeVisible();

  const founder = await (await browser.newContext()).newPage();
  await signInWithCode(founder, "local-ceo@autograff.ai");
  await expect(founder).toHaveURL(/\/dashboard$/);
  await expect(founder.getByRole("list", { name: "Upcoming slots" }).getByRole("listitem").first()).toBeVisible();
  const focus = founder.getByRole("definition").filter({ hasText: "Repair shops under pressure" });
  await expect(focus).toBeVisible();
  await expect(founder.getByText("For you: CEO angle: customer trust")).toBeVisible();
  await expect(founder.getByText("COO angle")).toHaveCount(0);
  await expect(founder.getByText("Internal fact")).toHaveCount(0);
  for (const path of ["/admin/briefs", "/admin/calendar", `/admin/briefs/${next}`]) {
    const response = await founder.goto(path);
    expect(response?.status(), path).toBe(404);
  }
});
