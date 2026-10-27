import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge, Card, PageHeader } from "@/components/ui";
import { requireAdmin } from "@/lib/auth/dal";
import { addMonths, firstDayOfMonth, isIsoMonth, localToday, monthLabel, monthOf } from "@/lib/domain/dates";
import {
  DIVERSITY_FIELDS,
  FIELD_LABELS,
  NOT_SET,
  distribution,
  hotSpots,
  type DiversityField,
  type DiversityItem,
} from "@/lib/domain/diversity";
import { formatLabel } from "@/lib/domain/formats";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { PipelineTabs } from "../pipeline-tabs";

export const metadata: Metadata = { title: "Diversity" };

function valueLabel(field: DiversityField, value: string): string {
  if (value === NOT_SET) return value;
  if (field === "format") return formatLabel(value);
  if (field === "hook_type" || field === "cta") return value.replaceAll("_", " ");
  return value;
}

export default async function DiversityPage({ searchParams }: PageProps<"/admin/pipeline/diversity">) {
  await requireAdmin();
  const params = await searchParams;
  const month = typeof params.month === "string" ? params.month : monthOf(localToday("UTC"));
  if (!isIsoMonth(month)) notFound();

  const supabase = await createSupabaseServerClient();
  const [{ data: founders }, { data: drafts }] = await Promise.all([
    supabase.from("founders").select("id, display_name, role_title").order("created_at"),
    supabase
      .from("drafts")
      .select(
        "id, founder_id, concept:concepts(title, format), current:draft_versions!drafts_current_version_fk(fingerprint, review_flags(kind, status))",
      )
      .eq("target_month", firstDayOfMonth(month))
      .eq("is_external", false)
      .not("status", "in", "(rejected,archived)")
      .order("created_at"),
  ]);

  // The month's live drafts, by their current version's fingerprint.
  const items: DiversityItem[] = (drafts ?? []).map((d) => {
    const fingerprint = (d.current?.fingerprint ?? {}) as Record<string, unknown>;
    return {
      id: d.id,
      founderId: d.founder_id,
      title: d.concept?.title ?? "Draft",
      fingerprint: { format: d.concept?.format, ...fingerprint },
      repetitionWarnings: (d.current?.review_flags ?? []).filter((f) => f.kind === "repetition" && f.status === "open")
        .length,
    };
  });
  const shown = (founders ?? []).filter((f) => items.some((i) => i.founderId === f.id));
  const name = (id: string | null) =>
    id ? ((founders ?? []).find((f) => f.id === id)?.display_name ?? "?") : "everyone";
  const spots = hotSpots(items);

  return (
    <>
      <PageHeader
        title="Pipeline"
        description="How the month's live drafts spread over topics, formats, hooks, audiences, product mentions and calls to action, from each draft's fingerprint."
        actions={
          <div className="flex items-center gap-3 text-sm">
            <Link
              href={`/admin/pipeline/diversity?month=${addMonths(month, -1)}`}
              className="text-muted hover:text-foreground"
              aria-label="Previous month"
            >
              ←
            </Link>
            <span className="font-medium">{monthLabel(month)}</span>
            <Link
              href={`/admin/pipeline/diversity?month=${addMonths(month, 1)}`}
              className="text-muted hover:text-foreground"
              aria-label="Next month"
            >
              →
            </Link>
          </div>
        }
      />
      <PipelineTabs current="diversity" month={month} />

      {items.length === 0 ? (
        <Card>
          <p className="text-sm text-muted">No live drafts for {monthLabel(month)} yet.</p>
        </Card>
      ) : (
        <>
          <Card className="mb-6" aria-label="Repetition hot spots">
            <h2 className="mb-3 text-sm font-semibold">Repetition hot spots</h2>
            {spots.length === 0 ? (
              <p className="text-sm text-muted">
                None: no shared arguments, no value used by more than half the posts.
              </p>
            ) : (
              <ul className="space-y-2 text-sm">
                {spots.map((s, index) => (
                  <li key={index}>
                    {s.kind === "same_argument" ? (
                      <>
                        <Badge tone="danger">same argument</Badge> “{s.argument}” in{" "}
                        {s.items.map((i, n) => (
                          <span key={i.id}>
                            {n > 0 ? ", " : ""}
                            <Link href={`/admin/drafts/${i.id}`} className="text-accent hover:underline">
                              {i.title}
                            </Link>{" "}
                            <span className="text-muted">({name(i.founderId)})</span>
                          </span>
                        ))}
                      </>
                    ) : s.kind === "crowded" ? (
                      <>
                        <Badge tone="accent">crowded</Badge> {FIELD_LABELS[s.field]}: “{valueLabel(s.field, s.value)}”
                        in {s.count} of {s.of} posts for {name(s.founderId)}
                      </>
                    ) : (
                      <>
                        <Badge tone="accent">repetition warning</Badge>{" "}
                        <Link href={`/admin/drafts/${s.item.id}`} className="text-accent hover:underline">
                          {s.item.title}
                        </Link>{" "}
                        <span className="text-muted">
                          ({name(s.item.founderId)}): {s.item.repetitionWarnings} open
                        </span>
                      </>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <div className="grid gap-6 lg:grid-cols-2">
            {DIVERSITY_FIELDS.map((field) => (
              <Card key={field} className="overflow-x-auto p-0">
                <table aria-label={FIELD_LABELS[field]} className="w-full text-left text-sm">
                  <thead className="border-b border-border text-xs text-muted">
                    <tr>
                      <th className="px-4 py-2 font-medium">{FIELD_LABELS[field]}</th>
                      <th className="px-4 py-2 font-medium">All ({items.length})</th>
                      {shown.map((f) => (
                        <th key={f.id} className="px-4 py-2 font-medium">
                          {f.role_title}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {distribution(items, field).map((v) => (
                      <tr key={v.value} className="border-b border-border last:border-0">
                        <td className={v.value === NOT_SET ? "px-4 py-2 text-muted" : "px-4 py-2"}>
                          {valueLabel(field, v.value)}
                        </td>
                        <td className="px-4 py-2">{v.total}</td>
                        {shown.map((f) => (
                          <td key={f.id} className="px-4 py-2">
                            {v.byFounder[f.id] ?? "—"}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </Card>
            ))}
          </div>
        </>
      )}
    </>
  );
}
