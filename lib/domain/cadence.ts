// Publishing cadence and slot generation (docs/PRODUCT_SPEC.md §4.1–4.2).
// Pure and deterministic: the same rules and month always give the same slots.
// The database stores the result; this module is the only place it is computed.

import {
  addDays,
  eachDay,
  firstDayOfMonth,
  isoWeekNumber,
  isoWeekday,
  lastDayOfMonth,
  startOfIsoWeek,
  type IsoDate,
  type IsoMonth,
} from "./dates";

export type CadencePeriod = "week" | "month";

export type CadenceRule = {
  id: string;
  /** First day the rule applies (inclusive). */
  effectiveFrom: IsoDate;
  /** First day it no longer applies (exclusive), or null if open-ended. */
  effectiveTo: IsoDate | null;
  period: CadencePeriod;
  minPosts: number;
  maxPosts: number;
  /** Optional per-week targets cycled by ISO week number, e.g. [3, 2]. */
  weeklyPattern: number[] | null;
  /** ISO weekdays (Mon=1 … Sun=7) in order of preference. */
  publishingDays: number[];
  reservedTimelySlotsPerMonth: number;
};

export type SlotKind = "regular" | "reserved_timely";

export type GeneratedSlot = { date: IsoDate; kind: SlotKind; ruleId: string };

export type MonthTargets = { min: number; target: number; max: number };

export type RuleProblem = string;

/** Checks a rule the same way the database constraints do. */
export function validateRule(rule: Omit<CadenceRule, "id">): RuleProblem[] {
  const problems: RuleProblem[] = [];
  const days = rule.publishingDays;
  if (!Number.isInteger(rule.minPosts) || rule.minPosts < 1) problems.push("Minimum posts must be at least 1.");
  if (!Number.isInteger(rule.maxPosts) || rule.maxPosts < rule.minPosts)
    problems.push("Maximum posts must be at least the minimum.");
  if (days.length === 0) problems.push("Choose at least one publishing day.");
  if (days.some((d) => !Number.isInteger(d) || d < 1 || d > 7)) problems.push("Publishing days must be Monday–Sunday.");
  if (new Set(days).size !== days.length) problems.push("Each publishing day can only be chosen once.");
  if (rule.period === "week" && rule.maxPosts > days.length)
    problems.push("A weekly maximum can't exceed the number of publishing days.");
  if (rule.weeklyPattern) {
    if (rule.period !== "week") problems.push("A weekly pattern only applies to weekly cadences.");
    if (rule.weeklyPattern.length === 0) problems.push("A weekly pattern needs at least one week.");
    if (rule.weeklyPattern.some((n) => !Number.isInteger(n) || n < rule.minPosts || n > rule.maxPosts))
      problems.push("Each week in the pattern must be between the minimum and maximum.");
  }
  if (!Number.isInteger(rule.reservedTimelySlotsPerMonth) || rule.reservedTimelySlotsPerMonth < 0)
    problems.push("Reserved timely slots can't be negative.");
  if (rule.effectiveTo !== null && rule.effectiveTo <= rule.effectiveFrom)
    problems.push("The rule must end after it starts.");
  return problems;
}

function inEffect(rule: CadenceRule, date: IsoDate): boolean {
  return date >= rule.effectiveFrom && (rule.effectiveTo === null || date < rule.effectiveTo);
}

type Level = "min" | "target" | "max";

function postsForWeek(rule: CadenceRule, weekStart: IsoDate, level: Level): number {
  if (level === "min") return rule.minPosts;
  if (level === "max") return rule.maxPosts;
  if (rule.weeklyPattern?.length) {
    return rule.weeklyPattern[isoWeekNumber(weekStart) % rule.weeklyPattern.length];
  }
  return rule.maxPosts;
}

/** Dates a weekly rule produces inside [from, to]. */
function weeklyDates(rule: CadenceRule, from: IsoDate, to: IsoDate, level: Level): IsoDate[] {
  const dates: IsoDate[] = [];
  for (let week = startOfIsoWeek(from); week <= to; week = addDays(week, 7)) {
    const count = Math.min(postsForWeek(rule, week, level), rule.publishingDays.length);
    // The week's slots go on its most-preferred days; a week split across two
    // months keeps each slot in the month of its own date, never both.
    const chosen = rule.publishingDays.slice(0, count).map((weekday) => addDays(week, weekday - 1));
    for (const date of chosen) {
      if (date >= from && date <= to && inEffect(rule, date)) dates.push(date);
    }
  }
  return dates.sort();
}

/** Dates a monthly rule produces in `month`, spread evenly over its publishing days. */
function monthlyDates(rule: CadenceRule, month: IsoMonth, level: Level): IsoDate[] {
  const allDays = eachDay(firstDayOfMonth(month), lastDayOfMonth(month));
  const candidates = allDays.filter((d) => rule.publishingDays.includes(isoWeekday(d)) && inEffect(rule, d));
  if (candidates.length === 0) return [];
  const coveredShare = allDays.filter((d) => inEffect(rule, d)).length / allDays.length;
  const perMonth = level === "min" ? rule.minPosts : rule.maxPosts;
  const count = Math.min(Math.round(perMonth * coveredShare), candidates.length);
  // Midpoint sampling: 2 posts over ~12 candidate days land in weeks 2 and 4.
  return Array.from({ length: count }, (_, i) => candidates[Math.floor(((i + 0.5) * candidates.length) / count)]);
}

function datesForMonth(rules: CadenceRule[], month: IsoMonth, level: Level): { date: IsoDate; ruleId: string }[] {
  const from = firstDayOfMonth(month);
  const to = lastDayOfMonth(month);
  const out: { date: IsoDate; ruleId: string }[] = [];
  for (const rule of rules) {
    const dates = rule.period === "week" ? weeklyDates(rule, from, to, level) : monthlyDates(rule, month, level);
    for (const date of dates) out.push({ date, ruleId: rule.id });
  }
  return out.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}

/**
 * The slots for a founder in a month at the target level. Reserved timely
 * slots are carved out of the regular ones (evenly spaced), so they count
 * toward the target but are not filled with planned content.
 */
export function generateSlots(rules: CadenceRule[], month: IsoMonth): GeneratedSlot[] {
  const dated = datesForMonth(rules, month, "target");
  const reserved = new Set<number>();
  const wanted = Math.min(
    Math.max(0, ...rules.filter((r) => dated.some((d) => d.ruleId === r.id)).map((r) => r.reservedTimelySlotsPerMonth)),
    dated.length,
  );
  for (let i = 0; i < wanted; i++) reserved.add(Math.floor(((i + 1) * dated.length) / (wanted + 1)));
  return dated.map((slot, index) => ({ ...slot, kind: reserved.has(index) ? "reserved_timely" : "regular" }));
}

/** Minimum, target and maximum slot counts for a month. */
export function monthTargets(rules: CadenceRule[], month: IsoMonth): MonthTargets {
  return {
    min: datesForMonth(rules, month, "min").length,
    target: datesForMonth(rules, month, "target").length,
    max: datesForMonth(rules, month, "max").length,
  };
}

/** Plain-language summary, e.g. "2–3 posts a week on Tue, Wed, Thu". */
export function describeRule(rule: Pick<CadenceRule, "period" | "minPosts" | "maxPosts" | "publishingDays">): string {
  const names = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
  const count = rule.minPosts === rule.maxPosts ? `${rule.maxPosts}` : `${rule.minPosts}–${rule.maxPosts}`;
  const unit = rule.maxPosts === 1 ? "post" : "posts";
  const days = rule.publishingDays.map((d) => names[d - 1]).join(", ");
  return `${count} ${unit} a ${rule.period} on ${days}`;
}

/** Presets offered in the editor (data, not hard-wired behavior). */
export const CADENCE_PRESETS = {
  twoToThreePerWeek: { period: "week", minPosts: 2, maxPosts: 3, publishingDays: [2, 3, 4], weeklyPattern: null },
  twoPerMonth: { period: "month", minPosts: 2, maxPosts: 2, publishingDays: [2, 3, 4], weeklyPattern: null },
} as const satisfies Record<
  string,
  Pick<CadenceRule, "period" | "minPosts" | "maxPosts" | "publishingDays" | "weeklyPattern">
>;
