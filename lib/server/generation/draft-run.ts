import "server-only";
import { revalidatePath } from "next/cache";
import { estimateMaxCost } from "@/lib/domain/pricing";
import { DRAFT_MAX_OUTPUT_TOKENS, DRAFT_TEMPLATE, DRAFT_VERSION, buildDraftPrompt } from "@/lib/prompts/draft.v2";
import { REPETITION_JUDGE_MAX_OUTPUT_TOKENS } from "@/lib/prompts/repetition-judge.v1";
import { llmModels } from "@/lib/providers/llm";
import { promptText } from "@/lib/providers/llm/types";
import type { Json } from "@/lib/supabase/database.types";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { MissingInputError, buildDraftInput, resolveDraftRefs } from "./context";
import { startRun } from "./request";

// Room for the judge's prompt: the draft, five excerpts and its instructions.
const JUDGE_PROMPT_CHARACTERS = 6000 + 5 * 300 + 2000;

/**
 * Requests a draft run for a selected concept (or a regeneration of one of
 * its drafts), under the usual estimate and cost ceilings. Callers check
 * that the user is an admin.
 */
export async function requestDraftRun(
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
    const length = promptText(buildDraftPrompt(input.prompt)).length;
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
