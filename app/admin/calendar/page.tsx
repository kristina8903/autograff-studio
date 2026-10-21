import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge, Card, PageHeader, cx } from "@/components/ui";
import { requireAdmin } from "@/lib/auth/dal";
import { monthTargets } from "@/lib/domain/cadence";
import { coverage } from "@/lib/domain/coverage";
import {
  WEEKDAY_NAMES,
  addDays,
  addMonths,
  firstDayOfMonth,
  isIsoMonth,
  lastDayOfMonth,
  localToday,
  monthLabel,
  monthOf,
  shortDateLabel,
  startOfIsoWeek,
} from "@/lib/domain/dates";
import { toCadenceRule } from "@/lib/server/planning";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { AddSlotForm, PlanMonthForm, SlotActions } from "./calendar-forms";

export const metadata: Metadata = { title: "Calendar" };

// Literal class names so Tailwind keeps them.
const FOUNDER_COLORS = [
  "bg-blue-500/15 text-blue-700 dark:text-blue-300",
  "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
  "bg-amber-500/15 text-amber-800 dark:text-amber-300",
  "bg-fuchsia-500/15 text-fuchsia-700 dark:text-fuchsia-300",
  "bg-cyan-500/15 text-cyan-700 dark:text-cyan-300",
  "bg-rose-500/15 text-rose-700 dark:text-rose-300",
];

const KIND_LABEL = { regular: "Planned", reserved_timely: "Kept for news", manual: "Added" } as const;

export default async function CalendarPage({ searchParams }: PageProps<"/admin/calendar">) {
  await requireAdmin();
  const params = await searchParams;
  const today = localToday("UTC");
  const month = typeof params.month === "string" ? params.month : monthOf(today);
  if (!isIsoMonth(month)) notFound();
  const only = typeof params.founder === "string" ? params.founder : "all";

  const supabase = await createSupabaseServerClient();
  const [{ data: founderRows }, { data: ruleRows }, { data: slotRows }] = await Promise.all([
    supabase.from("founders").select("id, display_name, role_title, timezone").eq("active", true).order("created_at"),
    supabase.from("cadence_rules").select("*"),
    supabase
      .from("calendar_slots")
      .select("id, founder_id, slot_date, kind, status, note")
      .gte("slot_date", firstDayOfMonth(month))
      .lte("slot_date", lastDayOfMonth(month))
      .order("slot_date")
      .order("ordinal"),
  ]);
  const founders = (founderRows ?? []).map((f, index) => ({
    ...f,
    color: FOUNDER_COLORS[index % FOUNDER_COLORS.length],
  }));
  const byId = Object.fromEntries(founders.map((f) => [f.id, f]));
  const shown = only === "all" ? founders : founders.filter((f) => f.id === only);
  const slots = (slotRows ?? []).filter((s) => byId[s.founder_id] && (only === "all" || s.founder_id === only));

  // Month grid, Monday-first.
  const start = startOfIsoWeek(firstDayOfMonth(month));
  const weeks: string[][] = [];
  for (let week = start; week <= lastDayOfMonth(month); week = addDays(week, 7)) {
    weeks.push(Array.from({ length: 7 }, (_, i) => addDays(week, i)));
  }
  const filterHref = (founder: string) =>
    `/admin/calendar?month=${month}${founder === "all" ? "" : `&founder=${founder}`}`;

  return (
    <>
      <PageHeader
        title="Publishing calendar"
        description="Slots come from each founder's cadence. Planning only adds or removes open slots from today on; filled, skipped and manually added slots stay as they are."
        actions={
          <div className="flex items-center gap-3 text-sm">
            <Link
              href={`/admin/calendar?month=${addMonths(month, -1)}`}
              className="text-muted hover:text-foreground"
              aria-label="Previous month"
            >
              ←
            </Link>
            <span className="font-medium">{monthLabel(month)}</span>
            <Link
              href={`/admin/calendar?month=${addMonths(month, 1)}`}
              className="text-muted hover:text-foreground"
              aria-label="Next month"
            >
              →
            </Link>
          </div>
        }
      />

      <Card className="mb-6 overflow-x-auto p-0">
        <table aria-label="Coverage" className="w-full text-left text-sm">
          <thead className="border-b border-border text-xs text-muted">
            <tr>
              <th className="px-4 py-2 font-medium">Founder</th>
              <th className="px-4 py-2 font-medium">Slots required (range)</th>
              <th className="px-4 py-2 font-medium">Planned</th>
              <th className="px-4 py-2 font-medium">Kept for news</th>
              <th className="px-4 py-2 font-medium">Skipped</th>
              <th className="px-4 py-2 font-medium">Content ready</th>
            </tr>
          </thead>
          <tbody>
            {founders.map((f) => {
              const rules = (ruleRows ?? []).filter((r) => r.founder_id === f.id).map(toCadenceRule);
              const targets = monthTargets(rules, month);
              const c = coverage(
                (slotRows ?? []).filter((s) => s.founder_id === f.id),
                targets,
              );
              return (
                <tr key={f.id} className="border-b border-border last:border-0">
                  <td className="px-4 py-3">
                    <span className={cx("rounded px-1.5 py-0.5 text-xs font-medium", f.color)}>{f.role_title}</span>{" "}
                    {f.display_name}
                  </td>
                  <td className="px-4 py-3">
                    {rules.length ? (
                      <>
                        {targets.target}{" "}
                        <span className="text-muted">
                          ({targets.min}–{targets.max})
                        </span>
                      </>
                    ) : (
                      <Link href={`/admin/founders/${f.id}`} className="text-accent hover:underline">
                        Set a cadence
                      </Link>
                    )}
                  </td>
                  <td className="px-4 py-3">{c.required}</td>
                  <td className="px-4 py-3">{c.reservedTimely}</td>
                  <td className="px-4 py-3">{c.skipped}</td>
                  <td className="px-4 py-3 text-muted">From Phase 4</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </Card>

      <div className="mb-4 flex flex-wrap items-start justify-between gap-4">
        <nav aria-label="Filter by founder" className="flex flex-wrap gap-2 text-sm">
          {[{ id: "all", label: "Everyone" }, ...founders.map((f) => ({ id: f.id, label: f.role_title }))].map(
            (item) => (
              <Link
                key={item.id}
                href={filterHref(item.id)}
                className={cx(
                  "rounded-full border px-3 py-1",
                  only === item.id
                    ? "border-accent bg-accent/10 text-accent"
                    : "border-border text-muted hover:text-foreground",
                )}
              >
                {item.label}
              </Link>
            ),
          )}
        </nav>
        <PlanMonthForm month={month} label={monthLabel(month)} />
      </div>

      <Card className="mb-6 overflow-x-auto p-0">
        <table aria-label="Month" className="w-full table-fixed text-sm">
          <thead className="border-b border-border text-xs text-muted">
            <tr>
              {WEEKDAY_NAMES.map((d) => (
                <th key={d} className="px-2 py-2 text-left font-medium">
                  {d}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {weeks.map((week) => (
              <tr key={week[0]} className="border-b border-border last:border-0 align-top">
                {week.map((day) => {
                  const inMonth = monthOf(day) === month;
                  const daySlots = slots.filter((s) => s.slot_date === day);
                  return (
                    <td key={day} className={cx("h-20 px-2 py-1.5", !inMonth && "bg-background/60")}>
                      <span
                        className={cx(
                          "text-xs",
                          inMonth ? "text-muted" : "text-muted/50",
                          day === today && "font-semibold text-accent",
                        )}
                      >
                        {Number(day.slice(8))}
                      </span>
                      <div className="mt-1 flex flex-col gap-1">
                        {daySlots.map((s) => (
                          <span
                            key={s.id}
                            title={`${byId[s.founder_id].display_name}: ${KIND_LABEL[s.kind]}${s.status !== "open" ? `, ${s.status}` : ""}`}
                            className={cx(
                              "truncate rounded px-1.5 py-0.5 text-xs",
                              byId[s.founder_id].color,
                              s.kind === "reserved_timely" && "outline outline-1 outline-dashed",
                              s.status === "skipped" && "line-through opacity-50",
                            )}
                          >
                            {byId[s.founder_id].role_title}
                            {s.kind === "reserved_timely" ? " · news" : s.kind === "manual" ? " · added" : ""}
                          </span>
                        ))}
                      </div>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      <Card className="mb-6">
        <h2 className="mb-3 text-sm font-semibold">Add a one-off slot</h2>
        <AddSlotForm
          founders={shown.map((f) => ({ id: f.id, label: `${f.display_name} (${f.role_title})` }))}
          minDate={today}
        />
      </Card>

      <Card className="overflow-x-auto p-0">
        <table aria-label="Slots" className="w-full text-left text-sm">
          <thead className="border-b border-border text-xs text-muted">
            <tr>
              <th className="px-4 py-2 font-medium">Date</th>
              <th className="px-4 py-2 font-medium">Founder</th>
              <th className="px-4 py-2 font-medium">Type</th>
              <th className="px-4 py-2 font-medium">Status</th>
              <th className="px-4 py-2" />
            </tr>
          </thead>
          <tbody>
            {slots.map((s) => (
              <tr key={s.id} className="border-b border-border last:border-0">
                <td className="px-4 py-2">{shortDateLabel(s.slot_date)}</td>
                <td className="px-4 py-2">{byId[s.founder_id].display_name}</td>
                <td className="px-4 py-2">
                  {KIND_LABEL[s.kind]}
                  {s.note ? <span className="block text-xs text-muted">{s.note}</span> : null}
                </td>
                <td className="px-4 py-2">
                  <Badge tone={s.status === "filled" ? "success" : s.status === "skipped" ? "neutral" : "accent"}>
                    {s.status}
                  </Badge>
                </td>
                <td className="px-4 py-2">
                  {s.slot_date >= today ? (
                    <SlotActions slotId={s.id} status={s.status} kind={s.kind} minDate={today} />
                  ) : (
                    <span className="text-xs text-muted">Past</span>
                  )}
                </td>
              </tr>
            ))}
            {slots.length ? null : (
              <tr>
                <td colSpan={5} className="px-4 py-6 text-center text-muted">
                  No slots this month yet. Use “Plan slots” to create them from each founder&apos;s cadence.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </Card>
    </>
  );
}
