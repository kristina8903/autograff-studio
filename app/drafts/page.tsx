import type { Metadata } from "next";
import Link from "next/link";
import { AppShell } from "@/components/app-shell";
import { FOUNDER_NAV } from "@/components/founder-nav";
import { Badge, Card, PageHeader } from "@/components/ui";
import { requireFounder } from "@/lib/auth/dal";
import { monthLabel } from "@/lib/domain/dates";
import { FOUNDER_STATUS_LABELS } from "@/lib/domain/draft-states";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Your drafts" };

export default async function FounderDraftsPage() {
  const viewer = await requireFounder();
  const supabase = await createSupabaseServerClient();
  // Only this founder's own drafts that the admin shared with them.
  const [{ data: drafts }, { data: publishing }, { data: founder }] = await Promise.all([
    supabase.rpc("founder_drafts"),
    supabase.rpc("founder_publishing"),
    // Row-level security returns only this founder's own record.
    supabase.from("founders").select("timezone").maybeSingle(),
  ]);
  const timeZone = founder?.timezone ?? "UTC";
  const when = new Map((publishing ?? []).map((p) => [p.draft_id, p]));
  const waiting = (drafts ?? []).filter((d) => d.status === "founder_review");

  return (
    <AppShell nav={FOUNDER_NAV} email={viewer.email}>
      <PageHeader
        title="Your drafts"
        description="Posts the admin has shared with you. Edit them, ask for changes or a rewrite, and approve the ones you're happy to publish."
      />
      <Card className="overflow-x-auto p-0">
        <table aria-label="Your drafts" className="w-full text-left text-sm">
          <thead className="text-xs text-muted">
            <tr>
              <th className="px-4 py-2 font-medium">Post</th>
              <th className="px-4 py-2 font-medium">Month</th>
              <th className="px-4 py-2 font-medium">Status</th>
              <th className="px-4 py-2 font-medium">Version</th>
              <th className="px-4 py-2 font-medium">Goes out</th>
            </tr>
          </thead>
          <tbody>
            {(drafts ?? []).map((d) => (
              <tr key={d.id} className="border-t border-border">
                <td className="px-4 py-2">
                  <Link href={`/drafts/${d.id}`} className="font-medium hover:underline">
                    {d.title}
                  </Link>
                </td>
                <td className="px-4 py-2 text-muted">{monthLabel(d.target_month.slice(0, 7))}</td>
                <td className="px-4 py-2">
                  <Badge tone={d.status === "founder_review" ? "accent" : d.approved ? "success" : "neutral"}>
                    {FOUNDER_STATUS_LABELS[d.status] ?? d.status}
                  </Badge>
                </td>
                <td className="px-4 py-2 text-muted">v{d.version_no}</td>
                <td className="px-4 py-2 text-muted">
                  {when.get(d.id)?.published_at ? (
                    <a
                      href={when.get(d.id)!.linkedin_url!}
                      target="_blank"
                      rel="noopener noreferrer nofollow"
                      className="text-accent hover:underline"
                    >
                      Published{" "}
                      {new Date(when.get(d.id)!.published_at!).toLocaleDateString("en-US", {
                        dateStyle: "medium",
                        timeZone,
                      })}
                    </a>
                  ) : when.get(d.id)?.scheduled_for ? (
                    new Date(when.get(d.id)!.scheduled_for!).toLocaleString("en-US", {
                      dateStyle: "medium",
                      timeStyle: "short",
                      timeZone,
                    })
                  ) : (
                    "—"
                  )}
                </td>
              </tr>
            ))}
            {drafts?.length ? null : (
              <tr>
                <td className="px-4 py-3 text-muted" colSpan={5}>
                  Nothing to review yet. Drafts appear here when the admin shares them with you.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </Card>
      {waiting.length ? (
        <p className="mt-3 text-sm text-muted">
          {waiting.length} draft{waiting.length === 1 ? " is" : "s are"} waiting for your review.
        </p>
      ) : null}
    </AppShell>
  );
}
