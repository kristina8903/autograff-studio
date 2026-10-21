import "server-only";
import { requireAdmin } from "@/lib/auth/dal";
import { isAllowedEmail, normalizeEmail } from "@/lib/domain/access";
import { publicEnv } from "@/lib/env";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseAdminClient } from "./client";

export type AdminResult = { ok: true } | { ok: false; error: string };

/**
 * Invites a founder by email and links the new login to their founder record.
 * The admin is re-verified here; the Auth hook and the database re-check the
 * email domain independently.
 */
export async function inviteFounder(founderId: string, rawEmail: string): Promise<AdminResult> {
  const admin = await requireAdmin();
  const email = normalizeEmail(rawEmail);
  if (!email) return { ok: false, error: "Enter a valid email address." };

  const supabase = await createSupabaseServerClient();
  const [{ data: settings }, { data: founder }] = await Promise.all([
    supabase.from("settings").select("allowed_email_domains").maybeSingle(),
    supabase.from("founders").select("id, user_id").eq("id", founderId).maybeSingle(),
  ]);
  if (!settings || !isAllowedEmail(email, settings.allowed_email_domains)) {
    return {
      ok: false,
      error: `Only ${settings?.allowed_email_domains.map((d) => "@" + d).join(", ") ?? "company"} addresses can be invited.`,
    };
  }
  if (!founder) return { ok: false, error: "Founder not found." };
  if (founder.user_id) return { ok: false, error: "This founder already has a login." };

  const service = createSupabaseAdminClient();
  const invited = await service.auth.admin.inviteUserByEmail(email, {
    redirectTo: `${publicEnv().NEXT_PUBLIC_APP_URL}/auth/confirm`,
  });
  if (invited.error || !invited.data.user) {
    console.error("inviteFounder: invite failed", { code: invited.error?.code, status: invited.error?.status });
    return {
      ok: false,
      error:
        invited.error?.code === "email_exists"
          ? "That address already has a login."
          : "The invitation could not be sent. Try again.",
    };
  }

  const provisioned = await service.rpc("provision_invited_user", {
    p_user_id: invited.data.user.id,
    p_role: "founder",
    p_invited_by: admin.userId,
    p_founder_id: founder.id,
  });
  if (provisioned.error) {
    // Never leave an Auth user without a profile behind.
    await service.auth.admin.deleteUser(invited.data.user.id);
    console.error("inviteFounder: provisioning failed", { code: provisioned.error.code });
    return { ok: false, error: "The invitation could not be completed. Try again." };
  }
  return { ok: true };
}

/** Deactivates a user: blocks all data access at once, then bans the login. */
export async function deactivateUser(userId: string): Promise<AdminResult> {
  await requireAdmin();
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc("admin_deactivate_user", { p_user_id: userId });
  if (error) {
    return { ok: false, error: error.code === "42501" ? error.message : "The user could not be deactivated." };
  }
  // RLS already denies everything; the ban also stops session refresh.
  const { error: banError } = await createSupabaseAdminClient().auth.admin.updateUserById(userId, {
    ban_duration: "876000h",
  });
  if (banError) console.error("deactivateUser: ban failed", { code: banError.code });
  return { ok: true };
}
