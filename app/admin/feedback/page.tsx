import type { Metadata } from "next";
import Link from "next/link";
import { Badge, ButtonLink, Card, PageHeader, cx } from "@/components/ui";
import { requireAdmin } from "@/lib/auth/dal";
import { FEEDBACK_KIND_LABELS, changesVoice } from "@/lib/domain/feedback";
import { formatLabel } from "@/lib/domain/formats";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { AddFeedbackForm, ReviewFeedbackForm } from "./feedback-forms";

export const metadata: Metadata = { title: "Feedback" };

export default async function FeedbackPage({ searchParams }: PageProps<"/admin/feedback">) {
  await requireAdmin();
  const params = await searchParams;
  const status = params.status === "reviewed" ? "reviewed" : "proposed";
  const only = typeof params.founder === "string" ? params.founder : null;

  const supabase = await createSupabaseServerClient();
  let signalsQuery = supabase
    .from("feedback_signals")
    .select(
      "id, founder_id, kind, format, statement, proposed_by, status, review_note, reviewed_at, created_at, applied:voice_profile_versions(version_no)",
    )
    .order("created_at", { ascending: false });
  signalsQuery = status === "proposed" ? signalsQuery.eq("status", "proposed") : signalsQuery.neq("status", "proposed");
  if (only) signalsQuery = signalsQuery.eq("founder_id", only);
  const [{ data: founders }, { data: signals }] = await Promise.all([
    supabase.from("founders").select("id, display_name, role_title").eq("active", true).order("created_at"),
    signalsQuery,
  ]);
  const byId = Object.fromEntries((founders ?? []).map((f) => [f.id, f]));
  const tab = (value: string, label: string) => (
    <Link
      href={`/admin/feedback?status=${value}${only ? `&founder=${only}` : ""}`}
      className={cx(
        "rounded-full border px-3 py-1",
        status === value ? "border-accent bg-accent/10 text-accent" : "border-border text-muted hover:text-foreground",
      )}
    >
      {label}
    </Link>
  );

  return (
    <>
      <PageHeader
        title="Feedback"
        description="Feedback on how a founder writes. Only stable and format preferences can change a voice profile, and only when you apply them in a new profile version."
      />
      <Card className="mb-6">
        <h2 className="mb-3 text-sm font-semibold">Add feedback</h2>
        <AddFeedbackForm
          founders={(founders ?? []).map((f) => ({ id: f.id, label: `${f.display_name} (${f.role_title})` }))}
        />
      </Card>

      <nav aria-label="Feedback status" className="mb-4 flex gap-2 text-sm">
        {tab("proposed", "To review")}
        {tab("reviewed", "Reviewed")}
        {only ? (
          <Link href={`/admin/feedback?status=${status}`} className="px-2 py-1 text-muted hover:text-foreground">
            Show all founders
          </Link>
        ) : null}
      </nav>

      <Card className="overflow-x-auto p-0">
        <table aria-label="Feedback" className="w-full text-left text-sm">
          <thead className="border-b border-border text-xs text-muted">
            <tr>
              <th className="px-4 py-2 font-medium">Founder</th>
              <th className="px-4 py-2 font-medium">Feedback</th>
              <th className="px-4 py-2 font-medium">Kind</th>
              <th className="px-4 py-2 font-medium">{status === "proposed" ? "" : "Outcome"}</th>
            </tr>
          </thead>
          <tbody>
            {(signals ?? []).map((s) => (
              <tr key={s.id} className="border-b border-border align-top last:border-0">
                <td className="px-4 py-3">{byId[s.founder_id]?.display_name ?? "Former founder"}</td>
                <td className="px-4 py-3">
                  {s.statement}
                  <span className="block text-xs text-muted">
                    {s.proposed_by === "system" ? "Proposed by the system" : "Added by the admin"} ·{" "}
                    {new Date(s.created_at).toLocaleDateString("en-US", { dateStyle: "medium" })}
                  </span>
                </td>
                <td className="px-4 py-3">
                  {FEEDBACK_KIND_LABELS[s.kind]}
                  {s.format ? <span className="block text-xs text-muted">{formatLabel(s.format)}</span> : null}
                </td>
                <td className="px-4 py-3">
                  {s.status === "proposed" ? (
                    <div className="flex flex-col items-end gap-2">
                      {changesVoice(s.kind) ? (
                        <ButtonLink href={`/admin/voice/${s.founder_id}?signal=${s.id}`} className="h-8 px-2 text-xs">
                          Apply to voice profile
                        </ButtonLink>
                      ) : null}
                      <ReviewFeedbackForm signalId={s.id} canAccept={!changesVoice(s.kind)} />
                    </div>
                  ) : (
                    <>
                      <Badge tone={s.status === "accepted" ? "success" : "neutral"}>{s.status}</Badge>
                      {s.applied ? (
                        <Link
                          href={`/admin/voice/${s.founder_id}?v=${s.applied.version_no}`}
                          className="ml-2 text-xs text-accent hover:underline"
                        >
                          Voice profile v{s.applied.version_no}
                        </Link>
                      ) : null}
                      {s.review_note ? <span className="block text-xs text-muted">{s.review_note}</span> : null}
                    </>
                  )}
                </td>
              </tr>
            ))}
            {signals?.length ? null : (
              <tr>
                <td colSpan={4} className="px-4 py-6 text-center text-muted">
                  {status === "proposed" ? "Nothing to review." : "Nothing reviewed yet."}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </Card>
    </>
  );
}
