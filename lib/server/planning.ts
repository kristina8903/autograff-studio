import "server-only";
import { requireAdmin } from "@/lib/auth/dal";
import { generateSlots, type CadenceRule } from "@/lib/domain/cadence";
import { addMonths, firstDayOfMonth, localToday, monthOf, type IsoMonth } from "@/lib/domain/dates";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { Database } from "@/lib/supabase/database.types";

type RuleRow = Database["public"]["Tables"]["cadence_rules"]["Row"];

export function toCadenceRule(row: RuleRow): CadenceRule {
  return {
    id: row.id,
    effectiveFrom: row.effective_from,
    effectiveTo: row.effective_to,
    period: row.period,
    minPosts: row.min_posts,
    maxPosts: row.max_posts,
    weeklyPattern: row.weekly_pattern,
    publishingDays: row.publishing_days,
    reservedTimelySlotsPerMonth: row.reserved_timely_slots_per_month,
  };
}

export type PlanResult = { founderId: string; created: number; removed: number; outsideCadence: string[] };

/**
 * Plans (or re-plans) one founder's slots for a month: computes them from the
 * cadence rules in TypeScript and lets the database apply them under its rules
 * (nothing in the past, filled, skipped or manual is touched).
 */
export async function planMonth(founderId: string, month: IsoMonth): Promise<PlanResult> {
  await requireAdmin();
  const supabase = await createSupabaseServerClient();
  const [{ data: founder }, { data: rules }] = await Promise.all([
    supabase.from("founders").select("timezone").eq("id", founderId).single(),
    supabase.from("cadence_rules").select("*").eq("founder_id", founderId),
  ]);
  if (!founder) throw new Error("Founder not found.");
  const slots = generateSlots((rules ?? []).map(toCadenceRule), month);
  const { data, error } = await supabase.rpc("sync_calendar_slots", {
    p_founder_id: founderId,
    p_month: firstDayOfMonth(month),
    p_slots: slots.map((s) => ({ date: s.date, kind: s.kind, rule_id: s.ruleId })),
    p_today: localToday(founder.timezone),
  });
  if (error) throw new Error(error.message);
  const result = data as { created: number; removed: number; outside_cadence: string[] };
  return { founderId, created: result.created, removed: result.removed, outsideCadence: result.outside_cadence };
}

/** After a cadence change: re-plan every month from the change through the last planned month. */
export async function replanFrom(founderId: string, effectiveFrom: string): Promise<PlanResult[]> {
  await requireAdmin();
  const supabase = await createSupabaseServerClient();
  const { data: last } = await supabase
    .from("calendar_slots")
    .select("slot_date")
    .eq("founder_id", founderId)
    .gte("slot_date", effectiveFrom)
    .order("slot_date", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!last) return [];
  const results: PlanResult[] = [];
  for (let month = monthOf(effectiveFrom); month <= monthOf(last.slot_date); month = addMonths(month, 1)) {
    results.push(await planMonth(founderId, month));
  }
  return results;
}
