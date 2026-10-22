"use server";
// Assisted publishing (PRODUCT_SPEC §8.2). Every write is a database function
// that applies the publish gate itself (§8.1); nothing here is trusted for it.

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth/dal";
import { zonedToUtc } from "@/lib/domain/dates";
import { parseMetrics } from "@/lib/domain/reports";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export type ActionState = { error?: string; message?: string };
export type CopyResult = { text?: string; error?: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const LINKEDIN_URL = /^https:\/\/([a-z0-9-]+\.)?linkedin\.com\/\S+$/i;

function str(form: FormData, key: string): string {
  return String(form.get(key) ?? "").trim();
}

function refusal(error: { code?: string; message: string }, fallback: string): ActionState {
  if (error.code === "22023" || error.code === "23505")
    return { error: error.message.charAt(0).toUpperCase() + error.message.slice(1) + "." };
  if (error.code === "P0002") return { error: "Not found. Reload the page." };
  return { error: fallback };
}

function refresh(draftId?: string) {
  if (draftId) revalidatePath(`/admin/drafts/${draftId}`);
  revalidatePath("/admin/drafts");
  revalidatePath("/admin/calendar");
  revalidatePath("/admin/publications");
  revalidatePath("/admin/reports");
}

/** The founder's time zone, for reading the times the admin types. */
async function founderTimeZone(draftId: string): Promise<string | null> {
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase.from("drafts").select("founder:founders(timezone)").eq("id", draftId).maybeSingle();
  return data?.founder?.timezone ?? null;
}

export async function scheduleDraftAction(_state: ActionState, form: FormData): Promise<ActionState> {
  await requireAdmin();
  const draftId = str(form, "draft_id");
  const slotId = str(form, "slot_id");
  if (!UUID.test(draftId) || (slotId && !UUID.test(slotId))) return { error: "Not found. Reload the page." };
  const timeZone = await founderTimeZone(draftId);
  if (!timeZone) return { error: "Not found. Reload the page." };
  const at = zonedToUtc(str(form, "scheduled_for"), timeZone);
  if (!at) return { error: "Choose a date and time." };
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc("schedule_draft", {
    p_draft_id: draftId,
    p_scheduled_for: at.toISOString(),
    p_slot_id: (slotId || null) as string,
  });
  if (error) return refusal(error, "Not scheduled. Reload the page.");
  refresh(draftId);
  return { message: "Scheduled." };
}

export async function unscheduleDraftAction(_state: ActionState, form: FormData): Promise<ActionState> {
  await requireAdmin();
  const draftId = str(form, "draft_id");
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc("unschedule_draft", { p_draft_id: draftId });
  if (error) return refusal(error, "Not changed. Reload the page.");
  refresh(draftId);
  return { message: "Unscheduled. The approval stands." };
}

/** The exact approved text, from the server: never what is on screen. */
export async function approvedTextAction(draftId: string): Promise<CopyResult> {
  await requireAdmin();
  if (!UUID.test(draftId)) return { error: "Not found. Reload the page." };
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("approved_text", { p_draft_id: draftId });
  if (error) return { error: refusal(error, "Could not get the approved text.").error };
  return { text: data };
}

export async function recordPublicationAction(_state: ActionState, form: FormData): Promise<ActionState> {
  await requireAdmin();
  const draftId = str(form, "draft_id");
  const url = str(form, "linkedin_url");
  const asApproved = form.get("as_approved") === "on";
  const text = String(form.get("published_text") ?? "");
  if (!UUID.test(draftId)) return { error: "Not found. Reload the page." };
  if (!LINKEDIN_URL.test(url)) return { error: "Paste the post's LinkedIn link (https://www.linkedin.com/…)." };
  if (!asApproved && !text.trim())
    return { error: "Paste the text as it was posted, or tick “Posted exactly as approved”." };
  if (text.length > 6000) return { error: "Keep the text under 6,000 characters." };
  const timeZone = await founderTimeZone(draftId);
  const at = timeZone ? zonedToUtc(str(form, "published_at"), timeZone) : null;
  if (!at) return { error: "Give the date and time it was published." };
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc("record_publication", {
    p_draft_id: draftId,
    p_published_at: at.toISOString(),
    p_linkedin_url: url,
    p_published_text: (asApproved ? null : text) as string,
  });
  if (error) return refusal(error, "Not recorded. Reload the page.");
  refresh(draftId);
  return { message: "Publication recorded." };
}

export async function recordExternalAction(_state: ActionState, form: FormData): Promise<ActionState> {
  await requireAdmin();
  const founderId = str(form, "founder_id");
  const url = str(form, "linkedin_url");
  const text = String(form.get("published_text") ?? "");
  if (!UUID.test(founderId)) return { error: "Choose the founder." };
  if (!LINKEDIN_URL.test(url)) return { error: "Paste the post's LinkedIn link (https://www.linkedin.com/…)." };
  if (!text.trim()) return { error: "Paste the text that was posted." };
  if (text.length > 6000) return { error: "Keep the text under 6,000 characters." };
  const supabase = await createSupabaseServerClient();
  const { data: founder } = await supabase.from("founders").select("timezone").eq("id", founderId).maybeSingle();
  const at = founder ? zonedToUtc(str(form, "published_at"), founder.timezone) : null;
  if (!at) return { error: "Give the date and time it was published." };
  const { error } = await supabase.rpc("record_external_publication", {
    p_founder_id: founderId,
    p_published_at: at.toISOString(),
    p_linkedin_url: url,
    p_published_text: text,
  });
  if (error)
    return error.code === "23505"
      ? { error: "That LinkedIn post is already recorded." }
      : refusal(error, "Not recorded. Reload the page.");
  refresh();
  return { message: "Recorded as published outside the studio." };
}

export async function addMetricsAction(_state: ActionState, form: FormData): Promise<ActionState> {
  await requireAdmin();
  const publicationId = str(form, "publication_id");
  if (!UUID.test(publicationId)) return { error: "Not found. Reload the page." };
  const parsed = parseMetrics(Object.fromEntries(form.entries()));
  if ("error" in parsed) return { error: parsed.error };
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc("add_performance_snapshot", {
    p_publication_id: publicationId,
    p_captured_at: new Date().toISOString(),
    p_metrics: parsed.metrics,
  });
  if (error) return refusal(error, "Not saved. Reload the page.");
  refresh(str(form, "draft_id") || undefined);
  return { message: "Metrics saved." };
}

export async function setExamplesAction(_state: ActionState, form: FormData): Promise<ActionState> {
  await requireAdmin();
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc("set_publications_become_examples", { p_on: form.get("on") === "on" });
  if (error) return { error: "Not saved. Reload the page." };
  refresh();
  return { message: "Saved." };
}
