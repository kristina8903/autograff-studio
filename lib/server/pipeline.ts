import "server-only";
import { monthTargets, type MonthTargets } from "@/lib/domain/cadence";
import {
  coverageStatus,
  fromCounts,
  isShortfall,
  replenishment,
  type Coverage,
  type CoverageStatus,
  type Replenishment,
} from "@/lib/domain/coverage";
import { addMonths, firstDayOfMonth, localToday, monthOf, type IsoDate, type IsoMonth } from "@/lib/domain/dates";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { Database } from "@/lib/supabase/database.types";
import { toCadenceRule } from "./planning";

type RuleRow = Database["public"]["Tables"]["cadence_rules"]["Row"];
type SqlCoverage = Database["public"]["Functions"]["coverage"]["Returns"][number];

/** The rule in effect on a date, or else the next one to start. */
function ruleOn(rules: RuleRow[], date: IsoDate): RuleRow | null {
  const sorted = [...rules].sort((a, b) => (a.effective_from < b.effective_from ? -1 : 1));
  return (
    sorted.find((r) => r.effective_from <= date && (r.effective_to === null || r.effective_to > date)) ??
    sorted.find((r) => r.effective_from > date) ??
    null
  );
}

export type FounderPipeline = {
  founder: { id: string; displayName: string; roleTitle: string; timezone: string };
  today: IsoDate;
  hasCadence: boolean;
  coverage: Coverage;
  /** Shown apart, never counted as supply. */
  apart: {
    scheduledOtherPeriod: number;
    heldRepeat: number;
    approvalInvalid: number;
    publishedDrafts: number;
    external: number;
    excluded: number;
  };
  status: CoverageStatus;
  bufferTarget: number;
  lowBufferThreshold: number;
  shortfall: boolean;
  nextOpenSlot: IsoDate | null;
  /** The month replenishment would fill, and what it proposes. */
  targetMonth: IsoMonth;
  targetPast: boolean;
  candidateTargetMax: number;
  replenishment: Replenishment;
};

export type PipelinePeriod = { first: IsoMonth; months: number };

export function periodMonths(period: PipelinePeriod): IsoMonth[] {
  return Array.from({ length: period.months }, (_, i) => addMonths(period.first, i));
}

/**
 * Coverage, status, shortfall and replenishment for each active founder (or
 * one), from public.coverage() and public.candidate_supply(). Reads only.
 */
export async function loadPipeline(period: PipelinePeriod, founderId?: string): Promise<FounderPipeline[]> {
  const supabase = await createSupabaseServerClient();
  let query = supabase.from("founders").select("id, display_name, role_title, timezone").eq("active", true);
  if (founderId) query = query.eq("id", founderId);
  const [{ data: founders }, { data: rules }] = await Promise.all([
    query.order("created_at"),
    supabase.from("cadence_rules").select("*"),
  ]);
  const months = periodMonths(period);
  const from = firstDayOfMonth(months[0]);
  const to = firstDayOfMonth(addMonths(months.at(-1)!, 1));

  return Promise.all(
    (founders ?? []).map(async (f) => {
      const today = localToday(f.timezone);
      const own = (rules ?? []).filter((r) => r.founder_id === f.id);
      const { data: row, error } = await supabase
        .rpc("coverage", { p_founder_id: f.id, p_from: from, p_to: to, p_today: today })
        .single();
      if (error || !row) throw new Error("Coverage could not be read.");
      const c = toCoverage(row, sumTargets(own, months));

      // Replenish the month of the next open slot in the period, else the first month not yet past.
      const nextOpenSlot = row.next_open_slot;
      const thisMonth = monthOf(today);
      const targetMonth =
        nextOpenSlot && nextOpenSlot >= from && nextOpenSlot < to
          ? monthOf(nextOpenSlot)
          : (months.find((m) => m >= thisMonth) ?? months[0]);
      const targetPast = targetMonth < thisMonth;
      const monthStart = firstDayOfMonth(targetMonth);
      const candidateRule = ruleOn(own, monthStart > today ? monthStart : today);
      const bufferRule = ruleOn(own, today);
      const { data: supply, error: supplyError } = await supabase
        .rpc("candidate_supply", { p_founder_id: f.id, p_month: monthStart })
        .single();
      if (supplyError || !supply) throw new Error("Coverage could not be read.");

      const buffer = {
        bufferTarget: bufferRule?.buffer_target ?? 0,
        lowBufferThreshold: bufferRule?.low_buffer_threshold ?? 0,
      };
      const candidateTargetMax = candidateRule?.candidate_target_max ?? 0;
      return {
        founder: { id: f.id, displayName: f.display_name, roleTitle: f.role_title, timezone: f.timezone },
        today,
        hasCadence: own.length > 0,
        coverage: c,
        apart: {
          scheduledOtherPeriod: row.scheduled_other_period,
          heldRepeat: row.held_repeat,
          approvalInvalid: row.approval_invalid,
          publishedDrafts: row.published_drafts,
          external: row.external_drafts,
          excluded: row.excluded,
        },
        status: coverageStatus(c, buffer, today, nextOpenSlot),
        ...buffer,
        shortfall: isShortfall(c.usableBuffer, buffer),
        nextOpenSlot,
        targetMonth,
        targetPast,
        candidateTargetMax,
        replenishment: replenishment({
          candidateTargetMax,
          conceptsOpen: supply.concepts_open,
          draftsInProgress: supply.drafts_in_progress,
          usableBuffer: c.usableBuffer,
          scheduled: supply.scheduled_in_month,
          // A month that has passed is never replenished.
          batchSize: targetPast ? 0 : supply.batch_size,
        }),
      };
    }),
  );
}

function sumTargets(rules: RuleRow[], months: IsoMonth[]): MonthTargets {
  const cadence = rules.map(toCadenceRule);
  return months
    .map((m) => monthTargets(cadence, m))
    .reduce((a, b) => ({ min: a.min + b.min, target: a.target + b.target, max: a.max + b.max }), {
      min: 0,
      target: 0,
      max: 0,
    });
}

function toCoverage(row: SqlCoverage, targets: MonthTargets): Coverage {
  return fromCounts(
    {
      required: row.slots_required,
      reservedTimely: row.slots_reserved_timely,
      open: row.slots_open,
      filled: row.slots_filled,
      skipped: row.slots_skipped,
    },
    targets,
    {
      published: row.published,
      scheduled: row.scheduled,
      approvedUnscheduled: row.approved_unscheduled,
      inFounderReview: row.in_founder_review,
      inAdminReview: row.in_admin_review,
      conceptsWaiting: row.concepts_waiting,
    },
  );
}
