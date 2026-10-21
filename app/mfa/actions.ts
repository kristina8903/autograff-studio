"use server";

import { redirect } from "next/navigation";
import { getViewer, homePathFor } from "@/lib/auth/dal";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export type EnrollState = { factorId?: string; qrCode?: string; secret?: string; error?: string };
export type VerifyState = { error?: string };

/** Starts enrolling an authenticator app. Leftover unverified attempts are removed first. */
export async function startEnrollment(): Promise<EnrollState> {
  const viewer = await getViewer();
  if (!viewer) redirect("/sign-in");
  const supabase = await createSupabaseServerClient();

  const { data: factors } = await supabase.auth.mfa.listFactors();
  for (const factor of factors?.all ?? []) {
    if (factor.status === "unverified") await supabase.auth.mfa.unenroll({ factorId: factor.id });
  }
  if (factors?.totp.some((factor) => factor.status === "verified")) redirect("/mfa");

  const { data, error } = await supabase.auth.mfa.enroll({
    factorType: "totp",
    friendlyName: `Authenticator ${new Date().toISOString().slice(0, 10)}`,
    issuer: "Autograff Content Studio",
  });
  if (error || !data) return { error: "Could not start setup. Try again." };
  return { factorId: data.id, qrCode: data.totp.qr_code, secret: data.totp.secret };
}

/** Confirms enrollment, or answers the challenge on a later sign-in. Either way the session becomes aal2. */
export async function verifyFactor(_state: VerifyState, form: FormData): Promise<VerifyState> {
  const viewer = await getViewer();
  if (!viewer) redirect("/sign-in");
  const factorId = String(form.get("factor_id") ?? "");
  const code = String(form.get("code") ?? "").replace(/\s/g, "");
  if (!factorId) return { error: "Start setup again." };
  if (!/^\d{6}$/.test(code)) return { error: "Enter the 6-digit code from your authenticator app." };

  const supabase = await createSupabaseServerClient();
  // The factor must belong to this user; listFactors only returns their own.
  const { data: factors } = await supabase.auth.mfa.listFactors();
  if (!factors?.all.some((factor) => factor.id === factorId)) return { error: "Start setup again." };

  const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId, code });
  if (error) return { error: "That code didn't work. Codes change every 30 seconds; try the current one." };
  redirect(homePathFor(viewer.role));
}
