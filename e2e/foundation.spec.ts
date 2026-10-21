import { expect, test, type Browser, type Page } from "@playwright/test";
import { SUPABASE_URL, accessTokenFrom, freshTotp, latestEmail, signInWithCode } from "./helpers";

// Phase 1 acceptance criteria (docs/PHASES.md) as one ordered story.
test.describe.configure({ mode: "serial" });

const ADMIN = "local-admin@autograff.ai";
const COO = "local-coo@autograff.ai";
const PUBLISHABLE_KEY = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? "";

let adminTotpSecret = "";
let adminPage: Page;
let founderPage: Page;

const cspViolations: string[] = [];

async function newPage(browser: Browser) {
  const page = await (await browser.newContext()).newPage();
  page.on("console", (message) => {
    if (/Content Security Policy|Refused to (execute|load|apply)/i.test(message.text()))
      cspViolations.push(message.text());
  });
  return page;
}

test("anonymous visitors are sent to sign-in and pages carry security headers", async ({ page }) => {
  for (const path of ["/", "/admin", "/admin/founders/new", "/dashboard", "/mfa"]) {
    await page.goto(path);
    await expect(page, path).toHaveURL(/\/sign-in$/);
  }
  const response = await page.request.get("/admin", { maxRedirects: 0 });
  expect(response.status()).toBe(307);
  const signIn = await page.request.get("/sign-in");
  const headers = signIn.headers();
  expect(headers["content-security-policy"]).toContain("frame-ancestors 'none'");
  expect(headers["content-security-policy"]).toMatch(/script-src 'self' 'nonce-[^']+' 'strict-dynamic'/);
  expect(headers["x-robots-tag"]).toBe("noindex, nofollow");
  expect(headers["cache-control"]).toContain("no-store");
});

test("public sign-up is impossible", async ({ request }) => {
  const response = await request.post(`${SUPABASE_URL}/auth/v1/signup`, {
    headers: { apikey: PUBLISHABLE_KEY },
    data: { email: "someone-new@autograff.ai", password: "a-long-password-123" },
  });
  expect(response.status()).toBe(422);
  expect((await response.json()).error_code).toBe("signup_disabled");
});

test("the sign-in form does not reveal which addresses have accounts", async ({ page }) => {
  await page.goto("/sign-in");
  await page.getByLabel("Work email").fill("not-a-user@autograff.ai");
  await page.getByRole("button", { name: "Email me a sign-in code" }).click();
  await expect(page.getByRole("heading", { name: "Check your email" })).toBeVisible();
});

test("an admin must enroll an authenticator before reaching admin pages", async ({ browser }) => {
  adminPage = await newPage(browser);
  await signInWithCode(adminPage, ADMIN);
  await expect(adminPage).toHaveURL(/\/mfa$/);
  await expect(adminPage.getByRole("heading", { name: "Set up two-factor sign-in" })).toBeVisible();

  // Signed in, but without MFA: the admin area stays closed.
  await adminPage.goto("/admin");
  await expect(adminPage).toHaveURL(/\/mfa$/);

  await adminPage.getByRole("button", { name: "Set up an authenticator app" }).click();
  adminTotpSecret = (await adminPage.getByTestId("totp-secret").textContent()) ?? "";
  expect(adminTotpSecret).toMatch(/^[A-Z2-7]+$/);
  await adminPage.getByLabel("6-digit code from your app").fill(await freshTotp(adminTotpSecret));
  await adminPage.getByRole("button", { name: "Verify" }).click();
  await expect(adminPage).toHaveURL(/\/admin$/);
  await expect(adminPage.getByRole("heading", { name: "Founders" })).toBeVisible();
  for (const name of ["Local CEO", "Local CTO", "Local COO"]) {
    await expect(adminPage.getByRole("link", { name, exact: true })).toBeVisible();
  }
});

test("only company addresses can be invited", async () => {
  await adminPage.getByRole("link", { name: "Local COO", exact: true }).click();
  await adminPage.getByLabel("Work email").fill("coo@gmail.com");
  await adminPage.getByRole("button", { name: "Send invitation" }).click();
  await expect(
    adminPage.getByRole("alert").filter({ hasText: "Only @autograff.ai addresses can be invited." }),
  ).toBeVisible();
});

test("an admin invites a founder, who accepts and sees only their own profile", async ({ browser }) => {
  const since = new Date(Date.now() - 1000);
  await adminPage.getByLabel("Work email").fill(COO);
  await adminPage.getByRole("button", { name: "Send invitation" }).click();
  await expect(adminPage.getByText("Invitation sent")).toBeVisible();

  const { html } = await latestEmail(COO, since);
  const link = html.match(/href="([^"]*\/auth\/confirm\?[^"]+)"/)?.[1]?.replaceAll("&amp;", "&");
  expect(link).toBeTruthy();

  founderPage = await newPage(browser);
  await founderPage.goto(link!);
  await expect(founderPage.getByRole("heading", { name: "Accept your invitation" })).toBeVisible();
  await founderPage.getByRole("button", { name: "Continue to Content Studio" }).click();
  await expect(founderPage).toHaveURL(/\/dashboard$/);
  await expect(founderPage.getByRole("heading", { name: "Welcome, Local COO" })).toBeVisible();

  // The admin sees the founder's login as active after their first sign-in.
  await adminPage.goto("/admin");
  await expect(
    adminPage.getByRole("table", { name: "Founders" }).getByRole("row", { name: /Local COO/ }),
  ).toContainText("active");
});

test("a founder cannot reach admin pages", async () => {
  for (const path of ["/admin", "/admin/founders/new", "/admin/founders/00000000-0000-4000-8000-0000000000f1"]) {
    const response = await founderPage.goto(path);
    expect(response?.status(), path).toBe(404);
  }
});

test("a founder's own token cannot read other founders or admin data through the API", async () => {
  const token = await accessTokenFrom(founderPage);
  const headers = { apikey: PUBLISHABLE_KEY, Authorization: `Bearer ${token}` };
  const api = founderPage.request;

  const founders = await (await api.get(`${SUPABASE_URL}/rest/v1/founders?select=display_name`, { headers })).json();
  expect(founders).toEqual([{ display_name: "Local COO" }]);
  const profiles = await (await api.get(`${SUPABASE_URL}/rest/v1/profiles?select=email`, { headers })).json();
  expect(profiles).toEqual([{ email: COO }]);
  expect(await (await api.get(`${SUPABASE_URL}/rest/v1/settings`, { headers })).json()).toEqual([]);
  expect(await (await api.get(`${SUPABASE_URL}/rest/v1/audit_events`, { headers })).json()).toEqual([]);

  const roleChange = await api.patch(`${SUPABASE_URL}/rest/v1/profiles?email=eq.${COO}`, {
    headers,
    data: { role: "admin" },
  });
  expect(roleChange.status()).toBe(403); // permission denied on the role column
  const after = await (await api.get(`${SUPABASE_URL}/rest/v1/profiles?select=role`, { headers })).json();
  expect(after).toEqual([{ role: "founder" }]);
  const rpc = await api.post(`${SUPABASE_URL}/rest/v1/rpc/admin_set_user_role`, {
    headers,
    data: { p_user_id: "00000000-0000-4000-8000-0000000000c1", p_role: "founder" },
  });
  expect(rpc.ok()).toBe(false);
});

test("a deactivated founder loses access immediately", async () => {
  await adminPage.goto("/admin");
  adminPage.once("dialog", (dialog) => dialog.accept());
  const teamRow = adminPage.getByRole("table", { name: "Team" }).getByRole("row", { name: new RegExp(COO) });
  await teamRow.getByRole("button", { name: "Deactivate" }).click();
  await expect(teamRow).toContainText("deactivated");

  await founderPage.goto("/dashboard");
  await expect(founderPage).toHaveURL(/\/sign-in$/);
});

test("a returning admin must pass the MFA challenge", async () => {
  await adminPage.getByRole("button", { name: "Sign out" }).click();
  await expect(adminPage).toHaveURL(/\/sign-in$/);
  await signInWithCode(adminPage, ADMIN);
  await expect(adminPage).toHaveURL(/\/mfa$/);
  await expect(adminPage.getByRole("heading", { name: "Two-factor sign-in" })).toBeVisible();
  await adminPage.getByLabel("6-digit code from your app").fill(await freshTotp(adminTotpSecret));
  await adminPage.getByRole("button", { name: "Verify" }).click();
  await expect(adminPage).toHaveURL(/\/admin$/);
});

test("no page violated the Content Security Policy", () => {
  expect(cspViolations).toEqual([]);
});
