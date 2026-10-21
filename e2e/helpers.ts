import { expect, type Page } from "@playwright/test";
import { TOTP } from "otpauth";

const MAILPIT = "http://127.0.0.1:54324/api/v1";
export const SUPABASE_URL = "http://127.0.0.1:54321";

type MailSummary = { ID: string; Created: string; To: { Address: string }[] };

/** Waits for the newest email to `address` sent after `since`, and returns its text and HTML. */
export async function latestEmail(address: string, since: Date): Promise<{ text: string; html: string }> {
  for (let attempt = 0; attempt < 40; attempt++) {
    const response = await fetch(`${MAILPIT}/search?query=${encodeURIComponent(`to:"${address}"`)}&limit=5`);
    const { messages } = (await response.json()) as { messages: MailSummary[] };
    const fresh = messages.find((message) => new Date(message.Created) >= since);
    if (fresh) {
      const message = (await (await fetch(`${MAILPIT}/message/${fresh.ID}`)).json()) as { Text: string; HTML: string };
      return { text: message.Text, html: message.HTML };
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`No email to ${address}`);
}

export async function signInWithCode(page: Page, email: string) {
  const since = new Date(Date.now() - 1000);
  await page.goto("/sign-in");
  await page.getByLabel("Work email").fill(email);
  await page.getByRole("button", { name: "Email me a sign-in code" }).click();
  await expect(page.getByRole("heading", { name: "Check your email" })).toBeVisible();
  const { text } = await latestEmail(email, since);
  const code = text.match(/\b(\d{6,8})\b/)?.[1];
  if (!code) throw new Error("No code in email");
  await page.getByLabel("Code from the email").fill(code);
  await page.getByRole("button", { name: "Sign in" }).click();
}

/** A TOTP code that has not been used before (the Auth server rejects reuse within a window). */
const usedCounters = new Set<string>();
export async function freshTotp(secret: string): Promise<string> {
  const totp = new TOTP({ secret, digits: 6, period: 30 });
  for (;;) {
    const counter = Math.floor(Date.now() / 30_000);
    const key = `${secret}:${counter}`;
    // Avoid the last 3 seconds of a window, and codes already used.
    if (!usedCounters.has(key) && Date.now() % 30_000 < 27_000) {
      usedCounters.add(key);
      return totp.generate();
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
}

/** The signed-in user's access token, read from the Supabase auth cookie. */
export async function accessTokenFrom(page: Page): Promise<string> {
  const cookies = await page.context().cookies();
  const parts = cookies
    .filter((cookie) => /^sb-.*-auth-token(\.\d+)?$/.test(cookie.name))
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((cookie) => cookie.value);
  const raw = parts.join("");
  const json = raw.startsWith("base64-")
    ? Buffer.from(raw.slice(7), "base64url").toString("utf8")
    : decodeURIComponent(raw);
  return (JSON.parse(json) as { access_token: string }).access_token;
}

/**
 * Signs the admin in, enrolling an authenticator the first time (the secret is
 * kept in `mfa` for later sign-ins in the same file).
 */
export async function signInAdmin(page: Page, email: string, mfa: { secret: string }) {
  await signInWithCode(page, email);
  await expect(page).toHaveURL(/\/mfa$/);
  if (!mfa.secret) {
    await page.getByRole("button", { name: "Set up an authenticator app" }).click();
    mfa.secret = (await page.getByTestId("totp-secret").textContent()) ?? "";
  }
  await page.getByLabel("6-digit code from your app").fill(await freshTotp(mfa.secret));
  await page.getByRole("button", { name: "Verify" }).click();
  await expect(page).toHaveURL(/\/admin$/);
}
