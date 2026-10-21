// Pure access rules, shared by the server guards and unit-tested in isolation.
// The database enforces the same rules independently (row-level security).

export type Role = "admin" | "founder";
export type AssuranceLevel = "aal1" | "aal2";

/** Lower-cases and trims an email address; returns null if it is not one. */
export function normalizeEmail(input: string): string | null {
  const email = input.trim().toLowerCase();
  return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) ? email : null;
}

/** Same rule as private.email_domain_allowed() in the database. */
export function isAllowedEmail(input: string, allowedDomains: readonly string[]): boolean {
  const email = normalizeEmail(input);
  if (!email) return false;
  const domain = email.slice(email.lastIndexOf("@") + 1);
  return allowedDomains.some((allowed) => allowed.toLowerCase() === domain);
}

export type SessionGate = "ok" | "verify_mfa" | "enroll_mfa" | "forbidden";

/**
 * Decides whether a signed-in user may enter an area of the app.
 *  - Anyone who has an authenticator must complete the MFA challenge (aal2).
 *  - Admin areas also require an authenticator to be enrolled at all.
 *  - A role that does not match the area is forbidden.
 */
export function gateSession(input: {
  role: Role;
  area: Role;
  currentLevel: AssuranceLevel | null;
  nextLevel: AssuranceLevel | null;
}): SessionGate {
  if (input.role !== input.area) return "forbidden";
  if (input.currentLevel === "aal2") return "ok";
  if (input.nextLevel === "aal2") return "verify_mfa";
  return input.area === "admin" ? "enroll_mfa" : "ok";
}

/** Where a user lands after signing in. */
export function homePathFor(role: Role): "/admin" | "/dashboard" {
  return role === "admin" ? "/admin" : "/dashboard";
}

const AUTH_LINK_TYPES = ["invite", "email", "magiclink"] as const;
export type AuthLinkType = (typeof AUTH_LINK_TYPES)[number];

export function parseAuthLinkType(value: string | null | undefined): AuthLinkType | null {
  return AUTH_LINK_TYPES.find((type) => type === value) ?? null;
}

/**
 * Paths that never require a session. Everything else does. The job tick has
 * no user session: it checks CRON_SECRET itself (app/api/jobs/tick/route.ts).
 */
export function isPublicPath(pathname: string): boolean {
  return (
    pathname === "/sign-in" ||
    pathname === "/api/jobs/tick" ||
    pathname.startsWith("/sign-in/") ||
    pathname === "/auth/confirm" ||
    pathname === "/robots.txt"
  );
}
