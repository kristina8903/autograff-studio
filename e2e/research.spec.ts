import { execFileSync } from "node:child_process";
import { expect, test, type Page } from "@playwright/test";
import { signInAdmin, signInWithCode } from "./helpers";

// Phase 5 acceptance criteria, against the fake research and AI providers.
test.describe.configure({ mode: "serial" });

const ADMIN = "local-admin@autograff.ai";
const MONTH = "2026-11";
const mfa = { secret: "" };
let admin: Page;
let draftPath = "";
const cspViolations: string[] = [];

const source = (title: string) => admin.getByRole("article", { name: `Source: ${title}` });

test.beforeAll(async ({ browser }) => {
  execFileSync("npx", ["supabase", "db", "reset"], { stdio: "ignore" });
  admin = await (await browser.newContext()).newPage();
  admin.on("console", (message) => {
    if (/Content Security Policy|Refused to (execute|load|apply)/i.test(message.text()))
      cspViolations.push(message.text());
  });
  await signInAdmin(admin, ADMIN, mfa);
});

test("the admin sets domain lists, refusing anything that isn't a domain", async () => {
  await admin.goto(`/admin/research?month=${MONTH}`);
  await admin.getByLabel("Never these domains").fill("blocked.example.net\nnot a domain");
  await admin.getByRole("button", { name: "Save domain lists" }).click();
  await expect(admin.getByText("Not domains: not, a, domain.")).toBeVisible();
  await admin.getByLabel("Never these domains").fill("https://www.blocked.example.net/anything");
  await admin.getByRole("button", { name: "Save domain lists" }).click();
  await expect(admin.getByText("Domain lists saved.")).toBeVisible();
  await admin.reload();
  await expect(admin.getByLabel("Never these domains")).toHaveValue("blocked.example.net");
});

test("research stores each source with its dates and excerpt; injected text changes nothing", async () => {
  await admin.getByLabel("Research question").fill("How long do repair approvals take?");
  await admin.getByRole("button", { name: "Run research" }).click();
  await expect(admin.getByText(/^Generating\. This run can cost up to \$0\.\d\d\.$/)).toBeVisible();
  await expect(admin.getByRole("heading", { name: "“How long do repair approvals take?”" })).toBeVisible({
    timeout: 20_000,
  });
  // Criterion 1: URL, title, publisher, dates and excerpt.
  const report = source("2026 Fleet Repair Report");
  await expect(report.getByRole("link", { name: "2026 Fleet Repair Report" })).toHaveAttribute(
    "href",
    "https://www.fleetresearch.example.org/2026-repair-report?utm_source=search",
  );
  await expect(report).toContainText("fleetresearch.example.org · Published or updated: March 4, 2026");
  await expect(report).toContainText("Retrieved: October");
  await expect(report).toContainText("About 27% of delays came from waiting for approvals");
  await expect(report).toContainText("Event date: 2025");
  // A page without a date says so.
  const injected = source("Why approvals stall repairs");
  await expect(injected).toContainText("date unknown");
  // Criteria 2 and 4: the obedient fake's injected finding was rejected, nothing else changed.
  await expect(admin.getByText(/1 finding rejected by the checks/)).toBeVisible();
  await expect(injected.getByRole("list", { name: "Findings" }).locator(":scope > li")).toHaveCount(1);
  await expect(injected.getByRole("list", { name: "Findings" })).not.toContainText("evil");
  await expect(admin.getByRole("link", { name: /evil/ })).toHaveCount(0);
  // The blocked domain never reaches the page.
  await expect(admin.getByText("10 shocking repair facts")).toHaveCount(0);
});

test("a finding can be verified only after its source is accepted; a dispute needs a reason", async () => {
  const report = source("2026 Fleet Repair Report");
  const findingRow = (text: string) => report.getByRole("listitem", { name: new RegExp(`^Finding: .*${text}`) });
  const finding = findingRow("About 27% of delays came from waiting");
  await expect(finding.getByRole("button", { name: "Verify" })).toBeDisabled();
  await report.getByLabel("Source type").selectOption("reputable_publication");
  await report.getByRole("button", { name: "Accept source" }).click();
  await expect(report).toContainText("accepted");
  await expect(report).toContainText("reputable publication");
  await finding.getByRole("button", { name: "Verify" }).click();
  await expect(finding).toContainText("verified");

  const other = findingRow("12.5 days");
  await other.getByRole("button", { name: "Dispute" }).click();
  await expect(other.getByText("Say why it is disputed (at least 5 characters).")).toBeVisible();
  await other.getByLabel("Finding note").fill("Figure covers 2025 only");
  await other.getByRole("button", { name: "Dispute" }).click();
  await expect(other).toContainText("disputed");
  await other
    .getByLabel("Conflicting finding")
    .selectOption({ label: "About 27% of delays came from waiting for approvals, a survey of 1,200 fleets found." });
  await other.getByRole("button", { name: "Link as conflicting" }).click();
  await expect(other).toContainText("Conflicts with:");
});

test("criterion 3: a draft cites the verified finding, with its source shown", async () => {
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

  const claims = admin.getByRole("table", { name: "Claims" });
  const cited = claims.getByRole("row").filter({ hasText: "About 27% of delays came from waiting for approvals" });
  await expect(cited).toContainText("supported");
  await expect(cited.getByRole("link", { name: "2026 Fleet Repair Report" })).toBeVisible();
  await expect(cited).toContainText("March 4, 2026");
  // The claim without a source is still flagged.
  await expect(claims.getByRole("row").filter({ hasText: "Most repair delays come from waiting" })).toContainText(
    "unsupported",
  );

  await admin.getByRole("button", { name: "Share with the founder" }).click();
  await expect(admin.getByText("with founder", { exact: true })).toBeVisible();
});

test("the founder sees the sources for their shared draft", async ({ browser }) => {
  const founder = await (await browser.newContext()).newPage();
  await signInWithCode(founder, "local-ceo@autograff.ai");
  await expect(founder).toHaveURL(/\/dashboard$/);
  await founder.goto(draftPath.replace("/admin/drafts/", "/drafts/"));
  const sources = founder.getByRole("list", { name: "Sources" });
  await expect(sources.getByRole("link", { name: "2026 Fleet Repair Report" })).toBeVisible();
  await expect(sources).toContainText("March 4, 2026");
  await expect(sources).toContainText("Source says: “About 27% of delays came from waiting for approvals");
  await expect(sources).toContainText("No source yet");
  // Research itself stays admin-only.
  expect((await founder.goto(`/admin/research?month=${MONTH}`))?.status()).toBe(404);
});

test("the research cost, searches included, is in the cost ledger", async () => {
  await admin.goto("/admin/ai");
  const run = admin.getByRole("table", { name: "Runs" }).getByRole("row").filter({ hasText: "Research" });
  await expect(run).toContainText("2 web searches");
  await expect(run).toContainText("succeeded");
});

test("no page violated the Content Security Policy", () => {
  expect(cspViolations).toEqual([]);
});
