"use server";
// The founder's review actions (PRODUCT_SPEC §7). Each one is a database
// function that checks the draft is the founder's own, shared with them and in
// the right state; nothing here is trusted for that.

import { after } from "next/server";
import { revalidatePath } from "next/cache";
import { requireFounder } from "@/lib/auth/dal";
import { runFounderGenerationNow } from "@/lib/server/admin/generation";
import { idempotencyKey } from "@/lib/server/generation/request";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export type ActionState = { error?: string; message?: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function str(form: FormData, key: string): string {
  return String(form.get(key) ?? "").trim();
}

function draftIdOf(form: FormData): string | null {
  const id = str(form, "draft_id");
  return UUID.test(id) ? id : null;
}

/** Readable messages for the database's refusals; anything else stays generic. */
function refusal(error: { code?: string; message: string }, fallback: string): ActionState {
  if (error.code === "40001")
    return { error: "The draft changed since you opened it. Reload to see the latest version." };
  if (error.code === "22023") return { error: error.message.charAt(0).toUpperCase() + error.message.slice(1) + "." };
  if (error.code === "P0002") return { error: "Draft not found." };
  return { error: fallback };
}

function refresh(draftId: string) {
  revalidatePath(`/drafts/${draftId}`);
  revalidatePath("/drafts");
  revalidatePath("/dashboard");
}

export async function founderSaveVersionAction(_state: ActionState, form: FormData): Promise<ActionState> {
  await requireFounder();
  const draftId = draftIdOf(form);
  const body = String(form.get("body") ?? "");
  if (!draftId) return { error: "Draft not found." };
  if (!body.trim()) return { error: "The post can't be empty." };
  if (body.length > 6000) return { error: "Keep the post under 6,000 characters." };
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("founder_save_version", {
    p_draft_id: draftId,
    p_body: body,
    p_change_note: str(form, "change_note").slice(0, 500),
  });
  if (error) return refusal(error, "Your edit could not be saved. Try again.");
  refresh(draftId);
  return { message: `Saved as version ${data}.` };
}

export async function approveDraftAction(_state: ActionState, form: FormData): Promise<ActionState> {
  await requireFounder();
  const draftId = draftIdOf(form);
  const versionId = str(form, "version_id");
  if (!draftId || !UUID.test(versionId)) return { error: "Draft not found." };
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc("approve_draft", {
    p_draft_id: draftId,
    p_version_id: versionId,
    p_note: str(form, "note").slice(0, 1000),
  });
  if (error) return refusal(error, "Not approved. Reload the page and try again.");
  refresh(draftId);
  return { message: "Approved." };
}

export async function revokeApprovalAction(_state: ActionState, form: FormData): Promise<ActionState> {
  await requireFounder();
  const draftId = draftIdOf(form);
  if (!draftId) return { error: "Draft not found." };
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc("revoke_approval", {
    p_draft_id: draftId,
    p_reason: str(form, "reason").slice(0, 200),
  });
  if (error) return refusal(error, "Not changed. Reload the page.");
  refresh(draftId);
  return { message: "Approval withdrawn." };
}

export async function requestChangesAction(_state: ActionState, form: FormData): Promise<ActionState> {
  await requireFounder();
  const draftId = draftIdOf(form);
  const comment = str(form, "comment");
  if (!draftId) return { error: "Draft not found." };
  if (!comment) return { error: "Say what should change." };
  if (comment.length > 2000) return { error: "Keep it under 2,000 characters." };
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc("request_changes", { p_draft_id: draftId, p_comment: comment });
  if (error) return refusal(error, "Not sent. Reload the page.");
  refresh(draftId);
  return { message: "Sent back to the admin with your note." };
}

export async function rejectDraftAction(_state: ActionState, form: FormData): Promise<ActionState> {
  await requireFounder();
  const draftId = draftIdOf(form);
  if (!draftId) return { error: "Draft not found." };
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc("founder_reject_draft", {
    p_draft_id: draftId,
    p_note: str(form, "note").slice(0, 1000),
  });
  if (error) return refusal(error, "Not changed. Reload the page.");
  refresh(draftId);
  return { message: "Rejected." };
}

export async function addCommentAction(_state: ActionState, form: FormData): Promise<ActionState> {
  await requireFounder();
  const draftId = draftIdOf(form);
  const body = str(form, "body");
  if (!draftId) return { error: "Draft not found." };
  if (!body) return { error: "Write a comment first." };
  if (body.length > 2000) return { error: "Keep a comment under 2,000 characters." };
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc("add_comment", {
    p_draft_id: draftId,
    p_body: body,
    p_quote: str(form, "quote").slice(0, 500),
    p_visibility: "shared",
  });
  if (error) return refusal(error, "Not saved. Try again.");
  refresh(draftId);
  return { message: "Comment added." };
}

/**
 * A rewrite with the founder's instructions: an AI run that adds a new
 * version. The database checks the daily limit and the budget, and reserves
 * the per-run ceiling.
 */
export async function requestRewriteAction(_state: ActionState, form: FormData): Promise<ActionState> {
  const viewer = await requireFounder();
  const draftId = draftIdOf(form);
  const instructions = str(form, "instructions");
  if (!draftId) return { error: "Draft not found." };
  if (!instructions) return { error: "Say what the rewrite should change." };
  if (instructions.length > 1000) return { error: "Keep the instructions under 1,000 characters." };
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("request_rewrite", {
    p_draft_id: draftId,
    p_instructions: instructions,
    p_idempotency_key: idempotencyKey([viewer.userId, draftId, instructions, str(form, "nonce")]),
  });
  if (error) return refusal(error, "The rewrite could not be requested.");
  const run = data[0];
  refresh(draftId);
  if (run.run_status === "refused")
    return { error: "The studio's AI budget can't cover a rewrite right now. Ask the admin." };
  if (run.run_status === "queued")
    after(async () => {
      try {
        await runFounderGenerationNow(run.run_id);
      } catch (e) {
        // The cron tick retries it; log the type only, never content.
        console.error("rewrite run did not start", run.run_id, e instanceof Error ? e.name : typeof e);
      }
    });
  return { message: "Rewriting. The new version appears here in a minute or so." };
}
