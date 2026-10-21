"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { normalizeEmail, parseAuthLinkType } from "@/lib/domain/access";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export type FormState = { error?: string };

// Remembers which address a code was sent to, so the address never sits in a URL.
const PENDING_EMAIL_COOKIE = "studio_signin_email";

export async function sendCode(_state: FormState, form: FormData): Promise<FormState> {
  const email = normalizeEmail(String(form.get("email") ?? ""));
  if (!email) return { error: "Enter your work email address." };

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.signInWithOtp({ email, options: { shouldCreateUser: false } });
  if (error && error.status === 429) {
    return { error: "Too many attempts. Wait a minute and try again." };
  }
  // Any other error (including "no such user") gets the same response as
  // success, so the form does not reveal which addresses have accounts.
  if (error) console.info("sendCode: not sent", { code: error.code });

  (await cookies()).set(PENDING_EMAIL_COOKIE, email, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/sign-in",
    maxAge: 60 * 60,
  });
  redirect("/sign-in/verify");
}

export async function verifyCode(_state: FormState, form: FormData): Promise<FormState> {
  const cookieStore = await cookies();
  const email = cookieStore.get(PENDING_EMAIL_COOKIE)?.value;
  if (!email) redirect("/sign-in");
  const token = String(form.get("code") ?? "").replace(/\s/g, "");
  // Supabase's code length is a project setting (6 locally; hosted projects may use 8).
  if (!/^\d{6,8}$/.test(token)) return { error: "Enter the code from the email." };

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.verifyOtp({ email, token, type: "email" });
  if (error) return { error: "That code didn't work. Check it, or request a new one." };

  const signedIn = await completeSignIn();
  if (!signedIn.ok) return { error: signedIn.error };
  cookieStore.delete({ name: PENDING_EMAIL_COOKIE, path: "/sign-in" });
  redirect("/");
}

/** Second step for email links: the token is only used when the person presses Continue. */
export async function confirmLink(_state: FormState, form: FormData): Promise<FormState> {
  const tokenHash = String(form.get("token_hash") ?? "");
  const type = parseAuthLinkType(String(form.get("type") ?? ""));
  if (!tokenHash || !type) return { error: "This link is incomplete. Request a new one." };

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type });
  if (error) return { error: "This link has expired or was already used. Request a new sign-in code." };

  const signedIn = await completeSignIn();
  if (!signedIn.ok) return { error: signedIn.error };
  redirect("/");
}

/** Activates an invited profile and audits the sign-in; ends the session if the account has no access. */
async function completeSignIn(): Promise<{ ok: true } | { ok: false; error: string }> {
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc("record_sign_in");
  if (error) {
    await supabase.auth.signOut();
    return { ok: false, error: "This account doesn't have access to Content Studio." };
  }
  return { ok: true };
}
