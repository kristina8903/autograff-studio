import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge, Card, PageHeader } from "@/components/ui";
import { requireAdmin } from "@/lib/auth/dal";
import { monthTargets } from "@/lib/domain/cadence";
import { addMonths, firstDayOfMonth, isIsoMonth, localToday, monthLabel, monthOf } from "@/lib/domain/dates";
import { formatLabel } from "@/lib/domain/formats";
import {
  average,
  groupBy,
  publishedPerMonth,
  type GroupStats,
  type Metrics,
  type PublicationRow,
} from "@/lib/domain/reports";
import { toCadenceRule } from "@/lib/server/planning";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Reports" };

const DAY = 86_400_000;
const SHOWN_METRICS = [
  ["impressions", "Avg. impressions"],
  ["reactions", "Avg. reactions"],
  ["comments", "Avg. comments"],
] as const;

function StatsTable({ label, groups, name }: { label: string; groups: GroupStats[]; name: (key: string) => string }) {
  return (
    <Card className="overflow-x-auto p-0">
      <table aria-label={label} className="w-full text-left text-sm">
        <thead className="border-b border-border text-xs text-muted">
          <tr>
            <th className="px-4 py-2 font-medium">{label}</th>
            <th className="px-4 py-2 font-medium">Published</th>
            <th className="px-4 py-2 font-medium">With metrics</th>
            {SHOWN_METRICS.map(([, title]) => (
              <th key={title} className="px-4 py-2 font-medium">
                {title}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {groups.map((g) => (
            <tr key={g.key} className="border-b border-border last:border-0">
              <td className="px-4 py-2">{name(g.key)}</td>
              <td className="px-4 py-2">{g.published}</td>
              <td className="px-4 py-2">{g.withMetrics}</td>
              {SHOWN_METRICS.map(([metric]) => {
                const value = average(g, metric);
                return (
                  <td key={metric} className="px-4 py-2">
                    {value === null ? "—" : Math.round(value).toLocaleString("en-US")}
                  </td>
                );
              })}
            </tr>
          ))}
          {groups.length ? null : (
            <tr>
              <td colSpan={5} className="px-4 py-3 text-muted">
                Nothing published in this period.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </Card>
  );
}

export default async function ReportsPage({ searchParams }: PageProps<"/admin/reports">) {
  await requireAdmin();
  const params = await searchParams;
  const to = typeof params.to === "string" ? params.to : monthOf(localToday("UTC"));
  const from = typeof params.from === "string" ? params.from : addMonths(to, -2);
  if (!isIsoMonth(from) || !isIsoMonth(to) || from > to) notFound();
  const months: string[] = [];
  for (let m = from; m <= to && months.length < 24; m = addMonths(m, 1)) months.push(m);

  const supabase = await createSupabaseServerClient();
  const [{ data: founders }, { data: rules }, { data: publications }] = await Promise.all([
    supabase.from("founders").select("id, display_name, role_title, timezone").eq("active", true).order("created_at"),
    supabase.from("cadence_rules").select("*"),
    supabase
      .from("publications")
      .select(
        "founder_id, published_at, is_external, draft:drafts(concept:concepts(format), brief:brief_versions(content)), performance_snapshots(captured_at, metrics)",
      )
      .gte("published_at", new Date(Date.parse(`${firstDayOfMonth(from)}T00:00:00Z`) - DAY).toISOString())
      .lt("published_at", new Date(Date.parse(`${firstDayOfMonth(addMonths(to, 1))}T00:00:00Z`) + DAY).toISOString())
      .order("captured_at", { referencedTable: "performance_snapshots", ascending: false }),
  ]);
  const byId = new Map((founders ?? []).map((f) => [f.id, f]));
  const refs = (founders ?? []).map((f) => ({ id: f.id, timezone: f.timezone }));
  const rows: PublicationRow[] = (publications ?? [])
    .map((p) => ({
      founderId: p.founder_id,
      publishedAt: p.published_at,
      isExternal: p.is_external,
      format: p.draft?.concept?.format ?? null,
      theme: (p.draft?.brief?.content as { theme?: string } | undefined)?.theme ?? null,
      metrics: (p.performance_snapshots[0]?.metrics as Metrics | undefined) ?? null,
    }))
    // Each founder's own calendar month decides the period.
    .filter((r) => {
      const tz = byId.get(r.founderId)?.timezone;
      return tz ? months.includes(monthOf(localToday(tz, new Date(r.publishedAt)))) : false;
    });
  const counts = publishedPerMonth(rows, refs);
  const nav = (f: string, t: string) => `/admin/reports?from=${f}&to=${t}`;

  return (
    <>
      <PageHeader
        title="Reports"
        description={`What was published, ${monthLabel(from)} to ${monthLabel(to)}, against each founder's cadence, and the metrics entered so far. Engagement is one input to planning, never a rule.`}
        actions={
          <div className="flex items-center gap-3 text-sm">
            <Link
              href={nav(addMonths(from, -1), addMonths(to, -1))}
              className="text-muted hover:text-foreground"
              aria-label="Earlier"
            >
              ←
            </Link>
            <span className="font-medium">
              {monthLabel(from)} – {monthLabel(to)}
            </span>
            <Link
              href={nav(addMonths(from, 1), addMonths(to, 1))}
              className="text-muted hover:text-foreground"
              aria-label="Later"
            >
              →
            </Link>
          </div>
        }
      />
      <div className="space-y-6">
        <Card className="overflow-x-auto p-0">
          <table aria-label="Published against cadence" className="w-full text-left text-sm">
            <thead className="border-b border-border text-xs text-muted">
              <tr>
                <th className="px-4 py-2 font-medium">Founder</th>
                {months.map((m) => (
                  <th key={m} className="px-4 py-2 font-medium">
                    {monthLabel(m)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {(founders ?? []).map((f) => {
                const founderRules = (rules ?? []).filter((r) => r.founder_id === f.id).map(toCadenceRule);
                return (
                  <tr key={f.id} className="border-b border-border last:border-0">
                    <td className="px-4 py-2">
                      {f.display_name} <span className="text-muted">({f.role_title})</span>
                    </td>
                    {months.map((m) => {
                      const c = counts.find((x) => x.founderId === f.id && x.month === m);
                      const target = founderRules.length ? monthTargets(founderRules, m) : null;
                      const total = c?.total ?? 0;
                      return (
                        <td key={m} className="px-4 py-2">
                          <span className="font-medium">{total}</span>
                          {target ? (
                            <span className="text-muted">
                              {" "}
                              of {target.min === target.max ? target.min : `${target.min}–${target.max}`}
                            </span>
                          ) : null}
                          {c?.external ? (
                            <span className="block text-xs text-muted">{c.external} outside the studio</span>
                          ) : null}
                          {target && total < target.min ? (
                            <Badge tone="danger">below cadence</Badge>
                          ) : target && total > target.max ? (
                            <Badge tone="accent">above cadence</Badge>
                          ) : null}
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Card>
        <StatsTable label="Theme" groups={groupBy(rows, (r) => r.theme)} name={(k) => k} />
        <StatsTable
          label="Format"
          groups={groupBy(rows, (r) => r.format)}
          name={(k) => (k.includes(" ") ? k : formatLabel(k))}
        />
        <StatsTable
          label="Founder"
          groups={groupBy(rows, (r) => r.founderId)}
          name={(k) => byId.get(k)?.display_name ?? k}
        />
      </div>
    </>
  );
}
