import "server-only";
import { cache } from "react";
import { notFound, redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { gateSession, homePathFor, type AssuranceLevel, type Role } from "@/lib/domain/access";

export type Viewer = {
  userId: string;
  email: string;
  displayName: string;
  role: Role;
  companyId: string;
  founderId: string | null;
  currentLevel: AssuranceLevel | null;
  nextLevel: AssuranceLevel | null;
};

/**
 * The signed-in user, verified with the Auth server on every request, plus
 * their profile as row-level security lets them see it. Null when there is no
 * session, or the account is missing or deactivated. Memoized per render pass
 * only; Server Actions and Route Handlers re-verify on every call.
 */
export const getViewer = cache(async (): Promise<Viewer | null> => {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: profile } = await supabase
    .from("profiles")
    .select("user_id, company_id, role, status, display_name, email")
    .eq("user_id", user.id)
    .maybeSingle();
  if (!profile || profile.status === "deactivated") return null;

  const { data: aal } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();

  let founderId: string | null = null;
  if (profile.role === "founder") {
    const { data: founder } = await supabase.from("founders").select("id").eq("user_id", user.id).maybeSingle();
    founderId = founder?.id ?? null;
  }

  return {
    userId: profile.user_id,
    email: profile.email,
    displayName: profile.display_name,
    role: profile.role,
    companyId: profile.company_id,
    founderId,
    currentLevel: (aal?.currentLevel as AssuranceLevel | null) ?? null,
    nextLevel: (aal?.nextLevel as AssuranceLevel | null) ?? null,
  };
});

/** Any signed-in user with an active account. */
export async function requireViewer(): Promise<Viewer> {
  const viewer = await getViewer();
  if (!viewer) redirect("/sign-in");
  return viewer;
}

async function requireArea(area: Role): Promise<Viewer> {
  const viewer = await requireViewer();
  switch (gateSession({ role: viewer.role, area, currentLevel: viewer.currentLevel, nextLevel: viewer.nextLevel })) {
    case "ok":
      return viewer;
    case "verify_mfa":
      redirect("/mfa");
    case "enroll_mfa":
      redirect("/mfa");
    case "forbidden":
      // Do not reveal that the area exists.
      notFound();
  }
}

/** Admin with an active account and a completed MFA challenge (aal2). */
export function requireAdmin(): Promise<Viewer> {
  return requireArea("admin");
}

/** Founder with an active account (and a completed MFA challenge if they enrolled). */
export function requireFounder(): Promise<Viewer> {
  return requireArea("founder");
}

export { homePathFor };
