"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireAdmin } from "@/lib/auth/dal";
import { MAX_EXAMPLE_LENGTH, isHttpsUrl, parseBulkPaste, parseTags } from "@/lib/domain/examples";
import { isIsoDate } from "@/lib/domain/dates";
import { FEEDBACK_KIND_LABELS, type FeedbackKind } from "@/lib/domain/feedback";
import { isPostFormat } from "@/lib/domain/formats";
import { parseVoiceForm } from "@/lib/domain/voice";
import type { Json } from "@/lib/supabase/database.types";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export type ActionState = { error?: string; errors?: Record<string, string>; message?: string };

const KINDS = ["published_linkedin", "approved_example", "other"] as const;
type Kind = (typeof KINDS)[number];

function str(form: FormData, key: string): string {
  return String(form.get(key) ?? "").trim();
}

// Supabase's generated types mark function arguments non-null; these take NULL for "not set".
function sqlNull<T>(value: T | null | undefined): T {
  return (value ?? null) as T;
}

function formatOrNull(value: string) {
  return isPostFormat(value) ? value : null;
}

// ---------------------------------------------------------------------------
// Voice profiles
// ---------------------------------------------------------------------------

export async function saveVoiceProfile(_state: ActionState, form: FormData): Promise<ActionState> {
  await requireAdmin();
  const founderId = str(form, "founder_id");
  const parsed = parseVoiceForm(form);
  if (!parsed.ok) return { errors: parsed.errors, error: "Check the highlighted fields." };
  const feedbackIds = form.getAll("feedback_id").map(String).filter(Boolean);

  const supabase = await createSupabaseServerClient();
  const { data: version, error } = await supabase.rpc("save_voice_profile_version", {
    p_founder_id: founderId,
    p_attributes: parsed.data.attributes,
    p_preferred_phrases: parsed.data.preferredPhrases,
    p_avoid_phrases: parsed.data.avoidPhrases,
    p_expertise_topics: parsed.data.expertiseTopics,
    p_writing_habits: parsed.data.writingHabits,
    p_style_rules: parsed.data.styleRules,
    p_format_preferences: parsed.data.formatPreferences,
    p_notes: parsed.data.notes,
    p_change_reason: parsed.data.changeReason,
    p_feedback_ids: feedbackIds,
  });
  if (error)
    return {
      error:
        error.code === "22023"
          ? "That feedback has already been reviewed, so it can't be applied. Reload the page."
          : "The voice profile could not be saved.",
    };
  revalidatePath("/admin/voice");
  revalidatePath("/admin/feedback");
  redirect(`/admin/voice/${founderId}?saved=${version}`);
}

// ---------------------------------------------------------------------------
// Writing examples
// ---------------------------------------------------------------------------

function kindOf(value: string): Kind {
  return (KINDS as readonly string[]).includes(value) ? (value as Kind) : "published_linkedin";
}

async function addExamples(founderId: string, items: Json[]): Promise<ActionState> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("add_writing_examples", { p_founder_id: founderId, p_items: items });
  if (error) return { error: "The examples could not be added." };
  const { added, duplicates } = data as { added: number; duplicates: number };
  revalidatePath(`/admin/voice/${founderId}/examples`);
  return {
    message:
      `Added ${added} example${added === 1 ? "" : "s"}.` +
      (duplicates ? ` Skipped ${duplicates} already in the library.` : ""),
  };
}

export async function addExampleAction(_state: ActionState, form: FormData): Promise<ActionState> {
  await requireAdmin();
  const body = str(form, "body");
  const sourceUrl = str(form, "source_url");
  const publishedAt = str(form, "published_at");
  if (!body) return { error: "Paste the text of the post." };
  if (body.length > MAX_EXAMPLE_LENGTH) return { error: "Keep an example under 10,000 characters." };
  if (sourceUrl && !isHttpsUrl(sourceUrl)) return { error: "The URL must start with https://." };
  if (publishedAt && !isIsoDate(publishedAt)) return { error: "Choose a valid date." };
  return addExamples(str(form, "founder_id"), [
    {
      kind: kindOf(str(form, "kind")),
      body,
      source_url: sourceUrl || null,
      published_at: publishedAt || null,
      format: formatOrNull(str(form, "format")),
      topics: parseTags(form.get("topics")),
      approved_for_voice: form.get("approved_for_voice") === "on",
    },
  ]);
}

export async function bulkAddExamplesAction(_state: ActionState, form: FormData): Promise<ActionState> {
  await requireAdmin();
  const { items, problems } = parseBulkPaste(String(form.get("posts") ?? ""));
  if (problems.length) return { error: `Nothing was added. ${problems.join(" ")}` };
  if (!items.length) return { error: "Paste at least one post." };
  const topics = parseTags(form.get("topics"));
  const format = formatOrNull(str(form, "format"));
  const approved = form.get("approved_for_voice") === "on";
  return addExamples(
    str(form, "founder_id"),
    items.map((item) => ({
      kind: "published_linkedin",
      body: item.body,
      source_url: item.sourceUrl,
      published_at: item.publishedAt,
      format,
      topics,
      approved_for_voice: approved,
    })),
  );
}

export async function updateExampleAction(_state: ActionState, form: FormData): Promise<ActionState> {
  await requireAdmin();
  const supabase = await createSupabaseServerClient();
  const id = str(form, "example_id");
  const { error } =
    form.get("intent") === "delete"
      ? await supabase.rpc("delete_writing_example", { p_example_id: id })
      : await supabase.rpc("update_writing_example", {
          p_example_id: id,
          p_approved_for_voice: form.get("approved_for_voice") === "on",
          p_eval_holdout: form.get("eval_holdout") === "on",
          p_format: sqlNull(formatOrNull(str(form, "format"))),
          p_topics: parseTags(form.get("topics")),
        });
  if (error) return { error: "Not saved." };
  revalidatePath(`/admin/voice/${str(form, "founder_id")}/examples`);
  return { message: "Saved." };
}

// ---------------------------------------------------------------------------
// Feedback signals
// ---------------------------------------------------------------------------

export async function addFeedbackAction(_state: ActionState, form: FormData): Promise<ActionState> {
  await requireAdmin();
  const kind = str(form, "kind");
  const statement = str(form, "statement");
  const format = formatOrNull(str(form, "format"));
  if (!Object.hasOwn(FEEDBACK_KIND_LABELS, kind)) return { error: "Choose what kind of feedback it is." };
  if (!statement) return { error: "Write the feedback." };
  if (statement.length > 1000) return { error: "Keep the feedback under 1,000 characters." };
  if (kind === "format_preference" && !format) return { error: "Choose the format this preference is about." };
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc("add_feedback_signal", {
    p_founder_id: str(form, "founder_id"),
    p_kind: kind as FeedbackKind,
    p_format: sqlNull(format),
    p_statement: statement,
  });
  if (error) return { error: "The feedback could not be saved." };
  revalidatePath("/admin/feedback");
  return { message: "Feedback added." };
}

export async function reviewFeedbackAction(_state: ActionState, form: FormData): Promise<ActionState> {
  await requireAdmin();
  const decision = form.get("decision") === "accept" ? "accept" : "reject";
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc("review_feedback_signal", {
    p_signal_id: str(form, "signal_id"),
    p_decision: decision,
    p_note: str(form, "note").slice(0, 500),
  });
  if (error) return { error: "Not saved. It may already have been reviewed." };
  revalidatePath("/admin/feedback");
  return { message: decision === "accept" ? "Accepted." : "Rejected." };
}
