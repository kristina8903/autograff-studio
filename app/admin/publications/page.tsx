import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge, Card, PageHeader } from "@/components/ui";
import { requireAdmin } from "@/lib/auth/dal";
import {
  addMonths,
  firstDayOfMonth,
  isIsoMonth,
  localDateTime,
  localToday,
  monthLabel,
  monthOf,
} from "@/lib/domain/dates";
import { METRIC_KEYS, METRIC_LABELS } from "@/lib/domain/reports";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { ExamplesSettingForm, ExternalPublicationForm, MetricsForm } from "../publishing-forms";

export const metadata: Metadata = { title: "Publications" };

const DAY = 86_400_000;

export default async function PublicationsPage({ searchParams }: PageProps<"/admin/publications">) {
  await requireAdmin();
  const params = await searchParams;
  const month = typeof params.month === "string" ? params.month : monthOf(localToday("UTC"));
  if (!isIsoMonth(month)) notFound();

  const supabase = await createSupabaseServerClient();
  const [{ data: founders }, { data: publications }, { data: settings }, { data: scheduled }] = await Promise.all([
    supabase.from("founders").select("id, display_name, role_title, timezone").eq("active", true).order("created_at"),
    supabase
      .from("publications")
      .select("*, draft:drafts(id, concept:concepts(title)), performance_snapshots(captured_at, metrics)")
      // A day either side, so every founder's own calendar month is covered.
      .gte("published_at", new Date(Date.parse(`${firstDayOfMonth(month)}T00:00:00Z`) - DAY).toISOString())
      .lt("published_at", new Date(Date.parse(`${firstDayOfMonth(addMonths(month, 1))}T00:00:00Z`) + DAY).toISOString())
      .order("published_at", { ascending: false })
      .order("captured_at", { referencedTable: "performance_snapshots", ascending: false }),
    supabase.from("settings").select("publications_become_examples").maybeSingle(),
    supabase
      .from("drafts")
      .select("id, founder_id, scheduled_for, concept:concepts(title)")
      .eq("status", "scheduled")
      .order("scheduled_for"),
  ]);
  const byId = new Map((founders ?? []).map((f) => [f.id, f]));
  const inMonth = (publications ?? []).filter((p) => {
    const tz = byId.get(p.founder_id)?.timezone ?? "UTC";
    return monthOf(localToday(tz, new Date(p.published_at))) === month;
  });
  const when = (iso: string, founderId: string) =>
    new Date(iso).toLocaleString("en-US", {
      dateStyle: "medium",
      timeStyle: "short",
      timeZone: byId.get(founderId)?.timezone ?? "UTC",
    });

  return (
    <>
      <PageHeader
        title="Publications"
        description="What was actually posted, and how it did. Studio posts are recorded from their draft; posts made outside the studio are recorded here."
        actions={
          <div className="flex items-center gap-3 text-sm">
            <Link
              href={`/admin/publications?month=${addMonths(month, -1)}`}
              className="text-muted hover:text-foreground"
              aria-label="Previous month"
            >
              ←
            </Link>
            <span className="font-medium">{monthLabel(month)}</span>
            <Link
              href={`/admin/publications?month=${addMonths(month, 1)}`}
              className="text-muted hover:text-foreground"
              aria-label="Next month"
            >
              →
            </Link>
          </div>
        }
      />
      <div className="grid gap-6 lg:grid-cols-[1fr_20rem]">
        <div className="space-y-6">
          <Card>
            <h2 className="mb-3 text-sm font-semibold">Scheduled</h2>
            {scheduled?.length ? (
              <ul aria-label="Scheduled posts" className="space-y-1 text-sm">
                {scheduled.map((d) => (
                  <li key={d.id}>
                    <Link href={`/admin/drafts/${d.id}`} className="text-accent hover:underline">
                      {d.concept?.title ?? "Draft"}
                    </Link>{" "}
                    · {byId.get(d.founder_id)?.display_name} ·{" "}
                    {d.scheduled_for ? when(d.scheduled_for, d.founder_id) : ""}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted">Nothing scheduled.</p>
            )}
          </Card>

          <section aria-label="Published" className="space-y-3">
            <h2 className="font-semibold">Published in {monthLabel(month)}</h2>
            {inMonth.map((p) => {
              const latest = p.performance_snapshots[0];
              const metrics = (latest?.metrics ?? {}) as Record<string, number>;
              return (
                <Card key={p.id}>
                  <article aria-label={`Publication: ${p.draft?.concept?.title ?? "External post"}`}>
                    <div className="flex flex-wrap items-center gap-2 text-sm">
                      {p.draft ? (
                        <Link href={`/admin/drafts/${p.draft.id}`} className="font-medium text-accent hover:underline">
                          {p.draft.concept?.title ?? "Draft"}
                        </Link>
                      ) : (
                        <span className="font-medium">Posted outside the studio</span>
                      )}
                      {p.is_external ? <Badge>external</Badge> : null}
                      {p.differs_from_approved ? <Badge tone="danger">text differs from approved</Badge> : null}
                    </div>
                    <p className="mt-1 text-xs text-muted">
                      {byId.get(p.founder_id)?.display_name} · {when(p.published_at, p.founder_id)} ·{" "}
                      <a
                        href={p.linkedin_url}
                        target="_blank"
                        rel="noopener noreferrer nofollow"
                        className="text-accent hover:underline"
                      >
                        LinkedIn
                      </a>
                    </p>
                    {latest ? (
                      <p className="mt-2 text-xs">
                        Metrics as of{" "}
                        {new Date(latest.captured_at).toLocaleDateString("en-US", { dateStyle: "medium" })}:{" "}
                        {METRIC_KEYS.filter((k) => typeof metrics[k] === "number")
                          .map((k) => `${METRIC_LABELS[k]} ${metrics[k].toLocaleString("en-US")}`)
                          .join(" · ")}
                      </p>
                    ) : (
                      <p className="mt-2 text-xs text-muted">No metrics yet.</p>
                    )}
                    <div className="mt-3">
                      <MetricsForm publicationId={p.id} />
                    </div>
                  </article>
                </Card>
              );
            })}
            {inMonth.length ? null : <p className="text-sm text-muted">Nothing published in {monthLabel(month)}.</p>}
          </section>
        </div>

        <div className="space-y-6">
          <Card className="h-fit">
            <h2 className="mb-3 text-sm font-semibold">Posted outside the studio</h2>
            <p className="mb-3 text-xs text-muted">
              Recorded for repetition checks and reports. It never counts as an approved studio post.
            </p>
            <ExternalPublicationForm
              founders={(founders ?? []).map((f) => ({
                id: f.id,
                label: `${f.display_name} (${f.role_title})`,
                now: localDateTime(f.timezone, new Date()),
              }))}
            />
          </Card>
          <Card className="h-fit">
            <h2 className="mb-3 text-sm font-semibold">Writing examples</h2>
            <ExamplesSettingForm on={settings?.publications_become_examples ?? true} />
          </Card>
        </div>
      </div>
    </>
  );
}
