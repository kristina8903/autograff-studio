import type { Metadata } from "next";
import Link from "next/link";
import { AppShell } from "@/components/app-shell";
import { FOUNDER_NAV } from "@/components/founder-nav";
import { Card, PageHeader } from "@/components/ui";
import { requireFounder } from "@/lib/auth/dal";
import {
  addMonths,
  firstDayOfMonth,
  lastDayOfMonth,
  localToday,
  monthLabel,
  monthOf,
  shortDateLabel,
} from "@/lib/domain/dates";
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
  const today = localToday(founder?.timezone ?? "UTC");
  // Row-level security limits this to the founder's own slots.
  const { data: slots } = await supabase
    .from("calendar_slots")
    .select("id, slot_date, kind")
    .eq("status", "open")
    .gte("slot_date", today)
    .lte("slot_date", lastDayOfMonth(addMonths(monthOf(today), 1)))
    .order("slot_date");
  // Only the theme and this founder's own emphasis; the rest of the brief is admin-only (D-13).
  const months = [monthOf(today), addMonths(monthOf(today), 1)];
  const briefs = (
    await Promise.all(months.map((month) => supabase.rpc("founder_brief", { p_month: firstDayOfMonth(month) })))
  ).flatMap(({ data }) => data ?? []);

  return (
    <AppShell nav={FOUNDER_NAV} email={viewer.email}>
      <PageHeader
        title={founder ? `Welcome, ${founder.display_name}` : "Welcome"}
        description="Drafts shared with you for review will appear here."
      />
      <div className="grid gap-6 sm:grid-cols-2">
        <Card className="sm:col-span-2">
          <h2 className="mb-3 font-semibold">Your upcoming publishing slots</h2>
          {slots?.length ? (
            <ul aria-label="Upcoming slots" className="flex flex-wrap gap-2 text-sm">
              {slots.map((slot) => (
                <li key={slot.id} className="rounded-md border border-border px-2.5 py-1">
                  {shortDateLabel(slot.slot_date)}
                  {slot.kind === "reserved_timely" ? <span className="text-muted"> · kept for news</span> : null}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted">No slots planned yet.</p>
          )}
        </Card>
        <Card className="sm:col-span-2">
          <h2 className="mb-3 font-semibold">Monthly focus</h2>
          {briefs.length ? (
            <dl aria-label="Monthly focus" className="space-y-3 text-sm">
              {briefs.map((brief) => (
                <div key={brief.month}>
                  <dt className="text-muted">{monthLabel(monthOf(brief.month))}</dt>
                  <dd className="font-medium">{brief.theme}</dd>
                  {brief.emphasis ? <dd className="mt-1">For you: {brief.emphasis}</dd> : null}
                </div>
              ))}
            </dl>
          ) : (
            <p className="text-sm text-muted">No monthly brief yet.</p>
          )}
        </Card>
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
