"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireAdmin } from "@/lib/auth/dal";
import { parseBriefForm } from "@/lib/domain/briefs";
import { validateRule, type CadencePeriod } from "@/lib/domain/cadence";
import { isIsoDate, isIsoMonth, localToday } from "@/lib/domain/dates";
import { planMonth, replanFrom } from "@/lib/server/planning";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export type ActionState = { error?: string; errors?: Record<string, string>; message?: string };

// Supabase's generated types mark every function argument non-null, but these
// SQL functions take NULL for "not set" (no weekly pattern; no new date).
function sqlNull<T>(value: T | null | undefined): T {
  return (value ?? null) as T;
}

// ---------------------------------------------------------------------------
// Briefs
// ---------------------------------------------------------------------------

export async function saveBrief(_state: ActionState, form: FormData): Promise<ActionState> {
  await requireAdmin();
  const month = String(form.get("month") ?? "");
  if (!isIsoMonth(month)) return { error: "Choose a month." };
  const supabase = await createSupabaseServerClient();
  const { data: founders } = await supabase.from("founders").select("id");
  const parsed = parseBriefForm(
    form,
    (founders ?? []).map((f) => f.id),
  );
  if (!parsed.ok) return { errors: parsed.errors, error: "Check the highlighted fields." };

  const { error } = await supabase.rpc("save_brief_version", {
    p_month: `${month}-01`,
    p_title: String(form.get("title") ?? "")
      .trim()
      .slice(0, 200),
    p_content: parsed.data.content,
    p_founder_emphasis: parsed.data.founderEmphasis,
    p_approved_facts: parsed.data.approvedFacts,
    p_change_note: parsed.data.changeNote,
  });
  if (error) return { error: "The brief could not be saved." };
  revalidatePath("/admin/briefs");
  redirect(`/admin/briefs/${month}?saved=1`);
}

// ---------------------------------------------------------------------------
// Cadence
// ---------------------------------------------------------------------------

function int(form: FormData, key: string, fallback = 0): number {
  const value = Number(form.get(key));
  return Number.isFinite(value) ? Math.trunc(value) : fallback;
}

export async function setCadence(_state: ActionState, form: FormData): Promise<ActionState> {
  await requireAdmin();
  const founderId = String(form.get("founder_id") ?? "");
  const effectiveFrom = String(form.get("effective_from") ?? "");
  if (!isIsoDate(effectiveFrom)) return { error: "Choose the date the new cadence starts." };
  const period = form.get("period") === "month" ? "month" : ("week" as CadencePeriod);
  const publishingDays = form.getAll("publishing_days").map(Number);
  const pattern = String(form.get("weekly_pattern") ?? "").trim();
  const weeklyPattern = pattern ? pattern.split(/[\s,]+/).map(Number) : null;
  const rule = {
    effectiveFrom,
    effectiveTo: null,
    period,
    minPosts: int(form, "min_posts"),
    maxPosts: int(form, "max_posts"),
    weeklyPattern: period === "week" ? weeklyPattern : null,
    publishingDays,
    reservedTimelySlotsPerMonth: int(form, "reserved_timely"),
  };
  const problems = validateRule(rule);
  if (problems.length) return { error: problems.join(" ") };

  const supabase = await createSupabaseServerClient();
  const { data: founder } = await supabase.from("founders").select("timezone").eq("id", founderId).single();
  if (!founder) return { error: "Founder not found." };
  const { error } = await supabase.rpc("set_cadence_rule", {
    p_founder_id: founderId,
    p_effective_from: effectiveFrom,
    p_period: period,
    p_min_posts: rule.minPosts,
    p_max_posts: rule.maxPosts,
    p_weekly_pattern: sqlNull(rule.weeklyPattern),
    p_publishing_days: publishingDays,
    p_reserved_timely: rule.reservedTimelySlotsPerMonth,
    p_buffer_target: int(form, "buffer_target"),
    p_low_buffer_threshold: int(form, "low_buffer_threshold"),
    p_candidate_target_min: int(form, "candidate_target_min"),
    p_candidate_target_max: int(form, "candidate_target_max"),
    p_change_reason: String(form.get("change_reason") ?? "")
      .trim()
      .slice(0, 500),
    p_today: localToday(founder.timezone),
  });
  if (error)
    return {
      error:
        error.code === "22023" || error.code === "23514"
          ? capitalize(error.message)
          : "The cadence could not be saved.",
    };

  const replanned = await replanFrom(founderId, effectiveFrom);
  const outside = replanned.flatMap((r) => r.outsideCadence);
  revalidatePath(`/admin/founders/${founderId}`);
  revalidatePath("/admin/calendar");
  return {
    message:
      `Cadence saved from ${effectiveFrom}.` +
      (replanned.length ? ` Re-planned ${replanned.length} month(s).` : "") +
      (outside.length ? ` Filled slots now outside the cadence, left as they are: ${outside.join(", ")}.` : ""),
  };
}

// ---------------------------------------------------------------------------
// Calendar
// ---------------------------------------------------------------------------

export async function planMonthAction(_state: ActionState, form: FormData): Promise<ActionState> {
  await requireAdmin();
  const month = String(form.get("month") ?? "");
  if (!isIsoMonth(month)) return { error: "Choose a month." };
  const supabase = await createSupabaseServerClient();
  const { data: founders } = await supabase.from("founders").select("id, display_name").eq("active", true);
  let created = 0;
  let removed = 0;
  const outside: string[] = [];
  for (const founder of founders ?? []) {
    try {
      const result = await planMonth(founder.id, month);
      created += result.created;
      removed += result.removed;
      outside.push(...result.outsideCadence.map((d) => `${founder.display_name} ${d}`));
    } catch {
      return { error: `Planning failed for ${founder.display_name}.` };
    }
  }
  revalidatePath("/admin/calendar");
  return {
    message: created || removed ? `Planned: ${created} slot(s) added, ${removed} removed.` : "Already up to date.",
    ...(outside.length ? { error: `Filled slots outside the cadence (left as they are): ${outside.join(", ")}` } : {}),
  };
}

export async function addSlotAction(_state: ActionState, form: FormData): Promise<ActionState> {
  await requireAdmin();
  const founderId = String(form.get("founder_id") ?? "");
  const date = String(form.get("date") ?? "");
  if (!isIsoDate(date)) return { error: "Choose a date." };
  const supabase = await createSupabaseServerClient();
  const { data: founder } = await supabase.from("founders").select("timezone").eq("id", founderId).single();
  if (!founder) return { error: "Choose a founder." };
  const { error } = await supabase.rpc("add_manual_slot", {
    p_founder_id: founderId,
    p_date: date,
    p_note: String(form.get("note") ?? "")
      .trim()
      .slice(0, 500),
    p_today: localToday(founder.timezone),
  });
  if (error) return { error: error.code === "22023" ? capitalize(error.message) : "The slot could not be added." };
  revalidatePath("/admin/calendar");
  return { message: "Slot added." };
}

export async function updateSlotAction(_state: ActionState, form: FormData): Promise<ActionState> {
  await requireAdmin();
  const slotId = String(form.get("slot_id") ?? "");
  const action = String(form.get("action") ?? "");
  if (!["skip", "unskip", "move", "delete"].includes(action)) return { error: "Unknown action." };
  const newDate = String(form.get("new_date") ?? "");
  if (action === "move" && !isIsoDate(newDate)) return { error: "Choose the new date." };
  const supabase = await createSupabaseServerClient();
  const { data: slot } = await supabase.from("calendar_slots").select("founders(timezone)").eq("id", slotId).single();
  if (!slot?.founders) return { error: "Slot not found." };
  const { error } = await supabase.rpc("update_slot", {
    p_slot_id: slotId,
    p_action: action,
    p_new_date: sqlNull(action === "move" ? newDate : null),
    p_today: localToday(slot.founders.timezone),
  });
  if (error) return { error: error.code === "22023" ? capitalize(error.message) : "The slot could not be changed." };
  revalidatePath("/admin/calendar");
  return {};
}

function capitalize(message: string): string {
  return message.charAt(0).toUpperCase() + message.slice(1) + (message.endsWith(".") ? "" : ".");
}
