import type { Metadata } from "next";
import Link from "next/link";
import { AppShell } from "@/components/app-shell";
import { Card, PageHeader } from "@/components/ui";
import { requireFounder } from "@/lib/auth/dal";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Your dashboard" };

export default async function FounderDashboard() {
  const viewer = await requireFounder();
  const supabase = await createSupabaseServerClient();
  // Row-level security returns only this founder's own record.
  const { data: founder } = await supabase
    .from("founders")
    .select("display_name, role_title, timezone, linkedin_profile_url")
    .maybeSingle();

  return (
    <AppShell nav={[{ href: "/dashboard", label: "Dashboard" }]} email={viewer.email}>
      <PageHeader
        title={founder ? `Welcome, ${founder.display_name}` : "Welcome"}
        description="Drafts shared with you for review will appear here."
      />
      <div className="grid gap-6 sm:grid-cols-2">
        <Card>
          <h2 className="mb-3 font-semibold">Your profile</h2>
          {founder ? (
            <dl className="space-y-2 text-sm">
              <div>
                <dt className="text-muted">Role</dt>
                <dd>{founder.role_title}</dd>
              </div>
              <div>
                <dt className="text-muted">Time zone</dt>
                <dd>{founder.timezone.replaceAll("_", " ")}</dd>
              </div>
              <div>
                <dt className="text-muted">LinkedIn</dt>
                <dd>{founder.linkedin_profile_url ?? "Not set"}</dd>
              </div>
            </dl>
          ) : (
            <p className="text-sm text-muted">Your profile isn&apos;t linked yet. Ask the admin.</p>
          )}
        </Card>
        <Card>
          <h2 className="mb-3 font-semibold">Two-factor sign-in</h2>
          {viewer.currentLevel === "aal2" ? (
            <p className="text-sm text-muted">
              On. You&apos;ll enter a code from your authenticator app when you sign in.
            </p>
          ) : (
            <p className="text-sm text-muted">
              Off.{" "}
              <Link href="/mfa" className="text-accent hover:underline">
                Set it up
              </Link>{" "}
              to protect your account.
            </p>
          )}
        </Card>
      </div>
    </AppShell>
  );
}
