"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth/dal";
import { lines, readSnapshot } from "@/lib/domain/briefs";
import { carryClaims, reviewDraft, type ModelClaim } from "@/lib/domain/draft-review";
import { estimateMaxCost } from "@/lib/domain/pricing";
import { readVoiceVersion } from "@/lib/domain/voice";
import { DRAFT_MAX_OUTPUT_TOKENS, DRAFT_TEMPLATE, DRAFT_VERSION, buildDraftPrompt } from "@/lib/prompts/draft.v1";
import { REPETITION_JUDGE_MAX_OUTPUT_TOKENS } from "@/lib/prompts/repetition-judge.v1";
import { llmModels } from "@/lib/providers/llm";
import { promptText } from "@/lib/providers/llm/types";
import { MissingInputError, buildDraftInput, resolveDraftRefs } from "@/lib/server/generation/context";
import { startRun } from "@/lib/server/generation/request";
import type { Json } from "@/lib/supabase/database.types";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export type ActionState = { error?: string; message?: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// Room for the judge's prompt: the draft, five excerpts and its instructions.
const JUDGE_PROMPT_CHARACTERS = 6000 + 5 * 300 + 2000;

function str(form: FormData, key: string): string {
  return String(form.get(key) ?? "").trim();
}

async function requestDraftRun(
  kind: "draft" | "draft_regen",
  conceptId: string,
  draftId: string | null,
  guidance: string,
  nonce: string,
) {
  const supabase = await createSupabaseServerClient();
  const { data: concept } = await supabase
    .from("concepts")
    .select("company_id, founder_id, target_month, status")
    .eq("id", conceptId)
    .maybeSingle();
  if (!concept) return { error: "Concept not found." };
  if (kind === "draft" && !["selected", "drafted"].includes(concept.status))
    return { error: "Select the concept before writing a draft." };

  const models = llmModels();
  let estimate: number;
  let refs;
  try {
    refs = await resolveDraftRefs(supabase, concept.company_id, conceptId);
    const input = await buildDraftInput(
      supabase,
      concept.company_id,
      refs,
      { conceptId, draftId, guidance },
      models.extract,
    );
    const length = promptText({ ...buildDraftPrompt(input.prompt), untrustedContext: [] }).length;
    estimate =
      estimateMaxCost(models.draft, length, DRAFT_MAX_OUTPUT_TOKENS) +
      estimateMaxCost(models.extract, JUDGE_PROMPT_CHARACTERS, REPETITION_JUDGE_MAX_OUTPUT_TOKENS);
  } catch (error) {
    if (error instanceof MissingInputError) return { error: error.message };
    throw error;
  }

  const result = await startRun({
    kind,
    founderId: concept.founder_id,
    month: concept.target_month.slice(0, 7),
    model: models.draft,
    template: DRAFT_TEMPLATE,
    templateVersion: DRAFT_VERSION,
    refs: refs as unknown as Json,
    params: { concept_id: conceptId, judge_model: models.extract, ...(draftId ? { draft_id: draftId, guidance } : {}) },
    estimate,
    keyParts: [conceptId, draftId ?? "", nonce],
  });
  revalidatePath("/admin/drafts");
  revalidatePath("/admin/concepts");
  revalidatePath("/admin/ai");
  return result;
}

export async function requestDraftAction(_state: ActionState, form: FormData): Promise<ActionState> {
  await requireAdmin();
  const conceptId = str(form, "concept_id");
  if (!UUID.test(conceptId)) return { error: "Concept not found." };
  return requestDraftRun("draft", conceptId, null, "", str(form, "nonce"));
}

export async function regenerateDraftAction(_state: ActionState, form: FormData): Promise<ActionState> {
  await requireAdmin();
  const draftId = str(form, "draft_id");
  if (!UUID.test(draftId)) return { error: "Draft not found." };
  const supabase = await createSupabaseServerClient();
  const { data: draft } = await supabase.from("drafts").select("concept_id, status").eq("id", draftId).maybeSingle();
  if (!draft?.concept_id) return { error: "This draft has no concept to write from." };
  if (!["drafting", "admin_review"].includes(draft.status))
    return { error: "Only drafts in review can be regenerated." };
  return requestDraftRun(
    "draft_regen",
    draft.concept_id,
    draftId,
    str(form, "guidance").slice(0, 500),
    str(form, "nonce"),
  );
}

/** A new version written by the admin. Lint, placeholder and claim flags are recomputed for the new text. */
export async function saveDraftVersionAction(_state: ActionState, form: FormData): Promise<ActionState> {
  await requireAdmin();
  const draftId = str(form, "draft_id");
  const body = String(form.get("body") ?? "");
  if (!UUID.test(draftId)) return { error: "Draft not found." };
  if (!body.trim()) return { error: "The post can't be empty." };
  if (body.length > 6000) return { error: "Keep the post under 6,000 characters." };
  const hooks = lines(form.get("alternative_hooks")).slice(0, 6);
  if (hooks.some((h) => h.length > 500)) return { error: "Keep each opening line under 500 characters." };
  const selected = str(form, "selected_hook");
  const selectedHook = selected === "" ? null : Number(selected);

  const supabase = await createSupabaseServerClient();
  const { data: draft } = await supabase
    .from("drafts")
    .select(
      "founder_id, brief:brief_versions(content, founder_emphasis, approved_facts), current:draft_versions!drafts_current_version_fk(id, draft_claims(claim_text, claim_kind, approved_fact))",
    )
    .eq("id", draftId)
    .maybeSingle();
  if (!draft?.brief || !draft.current) return { error: "Draft not found." };
  const { data: profile } = await supabase
    .from("voice_profiles")
    .select("current:voice_profile_versions!voice_profiles_current_version_fk(*)")
    .eq("founder_id", draft.founder_id)
    .maybeSingle();

  const approvedFacts = readSnapshot(draft.brief).approvedFacts;
  const voice = profile?.current ? readVoiceVersion(profile.current) : null;
  const previous: ModelClaim[] = draft.current.draft_claims.map((c) => {
    const index = c.approved_fact ? approvedFacts.indexOf(c.approved_fact) : -1;
    return { text: c.claim_text, kind: c.claim_kind, approved_fact_index: index >= 0 ? index : null };
  });
  const review = reviewDraft({
    body,
    claims: carryClaims(body, previous),
    // The model's and the repetition check's flags carry over in the database.
    modelFlags: [],
    approvedFacts,
    avoidPhrases: voice?.avoidPhrases ?? [],
    styleRules: voice?.styleRules ?? [],
  });

  const { data: versionNo, error } = await supabase.rpc("save_draft_version", {
    p_draft_id: draftId,
    p_body: body,
    p_alternative_hooks: hooks,
    p_selected_hook_index: selectedHook as number,
    p_change_note: str(form, "change_note").slice(0, 500),
    p_claims: review.records as unknown as Json,
    p_flags: review.flags as unknown as Json,
  });
  if (error) return { error: error.code === "22023" ? error.message : "The version could not be saved." };
  revalidatePath(`/admin/drafts/${draftId}`);
  revalidatePath("/admin/drafts");
  return { message: `Saved as version ${versionNo}.` };
}

export async function resolveFlagAction(_state: ActionState, form: FormData): Promise<ActionState> {
  await requireAdmin();
  const action = form.get("flag_action") === "override" ? "override" : "resolve";
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc("resolve_review_flag", {
    p_flag_id: str(form, "flag_id"),
    p_action: action,
    p_note: str(form, "note").slice(0, 500),
  });
  if (error) return { error: error.code === "22023" ? capitalize(error.message) + "." : "Not saved. Reload the page." };
  revalidatePath(`/admin/drafts/${str(form, "draft_id")}`);
  revalidatePath("/admin/drafts");
  return { message: action === "override" ? "Overridden." : "Resolved." };
}

const TRANSITIONS = ["drafting", "admin_review", "rejected", "archived"] as const;

export async function transitionDraftAction(_state: ActionState, form: FormData): Promise<ActionState> {
  await requireAdmin();
  const to = str(form, "to");
  if (!(TRANSITIONS as readonly string[]).includes(to)) return { error: "Unknown action." };
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc("transition_draft", {
    p_draft_id: str(form, "draft_id"),
    p_to: to as (typeof TRANSITIONS)[number],
    p_reason: str(form, "reason").slice(0, 200),
  });
  if (error) return { error: "Not changed. Reload the page." };
  revalidatePath(`/admin/drafts/${str(form, "draft_id")}`);
  revalidatePath("/admin/drafts");
  return {};
}

function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}
