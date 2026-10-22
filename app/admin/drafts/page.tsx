import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AutoRefresh } from "@/components/auto-refresh";
import { Badge, Card, PageHeader } from "@/components/ui";
import { requireAdmin } from "@/lib/auth/dal";
import { addMonths, firstDayOfMonth, isIsoMonth, localToday, monthLabel, monthOf } from "@/lib/domain/dates";
import { DRAFT_STATUS_LABELS } from "@/lib/domain/draft-states";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Drafts" };

export default async function DraftsPage({ searchParams }: PageProps<"/admin/drafts">) {
  await requireAdmin();
  const params = await searchParams;
  const month = typeof params.month === "string" ? params.month : addMonths(monthOf(localToday("UTC")), 1);
  if (!isIsoMonth(month)) notFound();
  const showAll = params.all === "1";

  const supabase = await createSupabaseServerClient();
  const [{ data: founders }, { data: drafts }, { data: runs }] = await Promise.all([
    supabase.from("founders").select("id, display_name, role_title").eq("active", true).order("created_at"),
    supabase
      .from("drafts")
      .select(
        "id, founder_id, status, updated_at, concept:concepts(title), current:draft_versions!drafts_current_version_fk(version_no, body, review_flags(severity, status))",
      )
      .eq("target_month", firstDayOfMonth(month))
      .order("created_at"),
    supabase
      .from("generation_runs")
      .select("id, founder_id, status, error_message")
      .eq("target_month", firstDayOfMonth(month))
      .in("kind", ["draft", "draft_regen"])
      .in("status", ["queued", "running", "failed", "refused"])
      .order("created_at", { ascending: false })
      .limit(20),
  ]);
  const active = (runs ?? []).some((r) => r.status === "queued" || r.status === "running");

  return (
    <>
      <AutoRefresh active={active} />
      <PageHeader
        title="Drafts"
        description="Posts written from selected concepts. Every edit or regeneration is a new version; flags must be cleared before a draft can go to its founder (Phase 7)."
        actions={
          <div className="flex items-center gap-3 text-sm">
            <Link
              href={`/admin/drafts?month=${addMonths(month, -1)}`}
              className="text-muted hover:text-foreground"
              aria-label="Previous month"
            >
              ←
            </Link>
            <span className="font-medium">{monthLabel(month)}</span>
            <Link
              href={`/admin/drafts?month=${addMonths(month, 1)}`}
              className="text-muted hover:text-foreground"
              aria-label="Next month"
            >
              →
            </Link>
          </div>
        }
      />
      {active ? (
        <p role="status" className="mb-4 text-sm text-muted">
          Writing… (a draft run is in progress)
        </p>
      ) : null}
      <p className="mb-4 text-sm">
        <Link href={`/admin/drafts?month=${month}${showAll ? "" : "&all=1"}`} className="text-accent hover:underline">
          {showAll ? "Hide rejected and archived drafts" : "Show rejected and archived drafts"}
        </Link>
      </p>
      {(founders ?? []).map((founder) => {
        const own = (drafts ?? []).filter(
          (d) => d.founder_id === founder.id && (showAll || (d.status !== "rejected" && d.status !== "archived")),
        );
        return (
          <section key={founder.id} aria-label={`Drafts for ${founder.display_name}`} className="mb-6">
            <h2 className="mb-2 text-lg font-semibold">
              {founder.display_name} <span className="text-sm font-normal text-muted">({founder.role_title})</span>
            </h2>
            <Card className="overflow-x-auto p-0">
              <table aria-label={`${founder.display_name}'s drafts`} className="w-full text-left text-sm">
                <tbody>
                  {own.map((draft) => {
                    const open = (draft.current?.review_flags ?? []).filter((f) => f.status === "open");
                    const blocking = open.filter((f) => f.severity === "blocking").length;
                    return (
                      <tr key={draft.id} className="border-b border-border align-top last:border-0">
                        <td className="px-4 py-3">
                          <Link href={`/admin/drafts/${draft.id}`} className="font-medium text-accent hover:underline">
                            {draft.concept?.title ?? "Untitled draft"}
                          </Link>
                          <span className="mt-1 block line-clamp-2 text-xs text-muted">{draft.current?.body}</span>
                        </td>
                        <td className="whitespace-nowrap px-4 py-3">
                          <Badge tone={draft.status === "rejected" ? "danger" : "accent"}>
                            {DRAFT_STATUS_LABELS[draft.status]}
                          </Badge>
                          <span className="ml-2 text-xs text-muted">v{draft.current?.version_no}</span>
                        </td>
                        <td className="whitespace-nowrap px-4 py-3 text-xs">
                          {blocking ? <Badge tone="danger">{blocking} blocking</Badge> : null}{" "}
                          {open.length - blocking ? <Badge>{open.length - blocking} to check</Badge> : null}
                          {open.length === 0 ? <span className="text-muted">No open flags</span> : null}
                        </td>
                      </tr>
                    );
                  })}
                  {own.length ? null : (
                    <tr>
                      <td className="px-4 py-4 text-muted">
                        No drafts yet. Select a concept on the{" "}
                        <Link href={`/admin/concepts?month=${month}`} className="text-accent hover:underline">
                          Concepts
                        </Link>{" "}
                        page and choose “Write a draft”.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </Card>
          </section>
        );
      })}
    </>
  );
}
