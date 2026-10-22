import { execFileSync } from "node:child_process";
import { expect, test, type Page } from "@playwright/test";
import { signInAdmin, signInWithCode } from "./helpers";

// Phase 4a acceptance criteria, against the fake AI provider (no real calls).
test.describe.configure({ mode: "serial" });

const ADMIN = "local-admin@autograff.ai";
const MONTH = "2026-11"; // the seeded brief
const mfa = { secret: "" };
let admin: Page;
const cspViolations: string[] = [];

/** Runs SQL as the database owner in the local stack, for test setup only. */
function sql(statement: string) {
  execFileSync("docker", ["exec", "supabase_db_autograff-studio", "psql", "-U", "postgres", "-qc", statement], {
    stdio: "ignore",
  });
}

const ceoConcepts = () => admin.getByRole("list", { name: "Local CEO's concepts" });
// The concept cards themselves, not the bullet points inside them.
const ceoCards = () => ceoConcepts().locator(":scope > li");
const ceoSection = () => admin.getByRole("region", { name: "Concepts for Local CEO" });

test.beforeAll(async ({ browser }) => {
  execFileSync("npx", ["supabase", "db", "reset"], { stdio: "ignore" });
  admin = await (await browser.newContext()).newPage();
  admin.on("console", (message) => {
    if (/Content Security Policy|Refused to (execute|load|apply)/i.test(message.text()))
      cspViolations.push(message.text());
  });
  await signInAdmin(admin, ADMIN, mfa);
});

test("a concept batch is generated and records what it was based on, the model and the cost", async () => {
  await admin.goto(`/admin/concepts?month=${MONTH}`);
  await ceoSection().getByLabel("Concepts for Local CEO").selectOption("3");
  await ceoSection().getByRole("button", { name: "Generate concepts" }).click();
  await expect(ceoSection().getByText(/^Generating\. This run can cost up to \$/)).toBeVisible();
  await expect(ceoCards()).toHaveCount(3, { timeout: 20_000 });
  await expect(ceoConcepts()).toContainText("Operational uncertainty in vehicle repair: angle 1");
  await expect(ceoConcepts()).toContainText("needs a personal story");

  await admin.getByRole("link", { name: "AI usage", exact: true }).click();
  const run = admin.getByRole("table", { name: "Runs" }).getByRole("row").nth(1);
  await expect(run).toContainText("Concepts");
  await expect(run).toContainText("Local CEO · 3");
  await expect(run).toContainText("brief · voice profile · 2 examples");
  await expect(run).toContainText("concepts v2");
  await expect(run).toContainText("claude-opus-5-5");
  await expect(run).toContainText("succeeded");
  await expect(run).toContainText(/\$\d/);
  await expect(admin.getByLabel("AI spend")).toContainText("of $10.00");
});

test("submitting the same request twice creates one run", async () => {
  await admin.goto(`/admin/concepts?month=${MONTH}`);
  const runsBefore = await countRuns();
  await ceoSection().getByLabel("Concepts for Local CEO").selectOption("1");
  // Two submissions of the same form (same nonce) before the page refreshes.
  await ceoSection()
    .locator("form")
    .first()
    .evaluate((form: HTMLFormElement) => {
      form.requestSubmit();
      form.requestSubmit();
    });
  await expect(ceoCards()).toHaveCount(4, { timeout: 20_000 });
  expect(await countRuns()).toBe(runsBefore + 1);
});

test("selecting, rejecting and regenerating one concept leave the others untouched", async () => {
  await admin.goto(`/admin/concepts?month=${MONTH}`);
  const items = ceoCards();
  const first = items.filter({ hasText: "angle 1" }).first();
  const second = items.filter({ hasText: "angle 2" }).first();
  const third = items.filter({ hasText: "angle 3" }).first();
  await first.getByRole("button", { name: "Select" }).click();
  await expect(first).toContainText("selected");
  await second.getByRole("button", { name: "Reject" }).click();
  await expect(second).toHaveCount(0); // rejected concepts are hidden by default

  await third.getByRole("button", { name: "Regenerate" }).click();
  await third.getByLabel("What should be different? (optional)").fill("More practical");
  await third.getByRole("button", { name: "Regenerate this concept" }).click();
  await expect(items.filter({ hasText: "angle 3" })).toHaveCount(0, { timeout: 20_000 });
  await expect(items).toHaveCount(3);
  await expect(first).toContainText("selected");

  await admin.getByRole("link", { name: "Show rejected and replaced concepts" }).click();
  await expect(items.filter({ hasText: "angle 3" })).toContainText("replaced");
  await expect(items.filter({ hasText: "angle 2" })).toContainText("rejected");
});

test("an edited concept keeps the change", async () => {
  await admin.goto(`/admin/concepts?month=${MONTH}`);
  // The concept selected in the previous test (the fake reuses titles across runs).
  const first = ceoCards().filter({ has: admin.getByText("selected", { exact: true }) });
  await first.getByRole("button", { name: "Edit" }).click();
  await first.getByLabel("Title").fill("Status updates are a product, not a courtesy");
  await first.getByRole("button", { name: "Save changes" }).click();
  await expect(first.getByText("Saved.")).toBeVisible();
  await admin.reload();
  await expect(ceoConcepts()).toContainText("Status updates are a product, not a courtesy");
});

test("a run over the per-run ceiling is refused before any call", async () => {
  sql("update public.settings set ai_per_run_ceiling_usd = 0.01");
  await admin.goto(`/admin/concepts?month=${MONTH}`);
  const runsBefore = await countRuns();
  await admin.goto(`/admin/concepts?month=${MONTH}`);
  await ceoSection().getByRole("button", { name: "Generate concepts" }).click();
  await expect(
    ceoSection().getByText(/^Not started\. This run could cost up to \$[\d.]+, over the \$0\.01 per-run ceiling\./),
  ).toBeVisible();
  await admin.goto("/admin/ai");
  await expect(admin.getByRole("table", { name: "Runs" }).getByRole("row").nth(1)).toContainText("refused");
  expect(await countRuns()).toBe(runsBefore + 1);
  sql("update public.settings set ai_per_run_ceiling_usd = 2");
});

test("the spend panel warns at 80% of the monthly budget", async () => {
  sql("update public.settings set ai_monthly_budget_usd = 0.01");
  await admin.goto("/admin/ai");
  await expect(admin.getByText("The monthly AI budget is used up.")).toBeVisible();
  sql("update public.settings set ai_monthly_budget_usd = 10");
});

test("a month without a brief asks for the brief first", async () => {
  await admin.goto("/admin/concepts?month=2027-03");
  await ceoSection().getByRole("button", { name: "Generate concepts" }).click();
  await expect(ceoSection().getByText("Write the March 2027 brief first.")).toBeVisible();
});

test("founders cannot reach concepts or AI usage", async ({ browser }) => {
  const founder = await (await browser.newContext()).newPage();
  await signInWithCode(founder, "local-ceo@autograff.ai");
  await expect(founder).toHaveURL(/\/dashboard$/);
  for (const path of ["/admin/concepts", "/admin/ai"]) {
    const response = await founder.goto(path);
    expect(response?.status(), path).toBe(404);
  }
});

test("the job tick refuses requests without the cron secret", async ({ request }) => {
  const response = await request.get("/api/jobs/tick");
  expect([401, 503]).toContain(response.status());
  const wrong = await request.get("/api/jobs/tick", { headers: { authorization: "Bearer wrong-secret-value" } });
  expect([401, 503]).toContain(wrong.status());
});

test("the job tick, with the cron secret, runs queued work", async ({ request }) => {
  sql(`insert into public.generation_runs (company_id, kind, founder_id, target_month, provider, model, prompt_template,
      prompt_template_version, input_refs, params, idempotency_key, estimated_cost_usd)
    values ('00000000-0000-4000-8000-000000000001', 'concept_batch', '00000000-0000-4000-8000-0000000000f3', '2026-11-01',
      'fake', 'claude-opus-5-5', 'concepts', 1,
      '{"brief_version_id": "00000000-0000-4000-8000-0000000000b1", "voice_profile_version_id": null, "example_ids": []}',
      '{"count": 2}', 'tick-test-000000000001', 0.1)`);
  const response = await request.get("/api/jobs/tick", {
    headers: { authorization: `Bearer ${process.env.CRON_SECRET}` },
  });
  expect(response.status()).toBe(200);
  const body = (await response.json()) as { processed: { status: string }[] };
  expect(body.processed).toEqual([expect.objectContaining({ status: "succeeded" })]);
  await admin.goto(`/admin/concepts?month=${MONTH}`);
  await expect(admin.getByRole("list", { name: "Local COO's concepts" }).locator(":scope > li")).toHaveCount(2);
});

test("no page violated the Content Security Policy", () => {
  expect(cspViolations).toEqual([]);
});

async function countRuns(): Promise<number> {
  const page = await admin.context().newPage();
  await page.goto("/admin/ai");
  const rows = await page.getByRole("table", { name: "Runs" }).getByRole("row").count();
  await page.close();
  return rows - 1;
}
