"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth/dal";
import { isIsoMonth } from "@/lib/domain/dates";
import { isPostFormat } from "@/lib/domain/formats";
import { estimateMaxCost } from "@/lib/domain/pricing";
import { lines } from "@/lib/domain/briefs";
import {
  CONCEPTS_MAX_OUTPUT_TOKENS,
  CONCEPTS_TEMPLATE,
  CONCEPTS_VERSION,
  MAX_CONCEPTS_PER_RUN,
  buildConceptPrompt,
} from "@/lib/prompts/concepts.v1";
import { llmModels } from "@/lib/providers/llm";
import { promptText } from "@/lib/providers/llm/types";
import {
  MissingInputError,
  buildConceptInput,
  resolveConceptRefs,
  type ConceptRefs,
} from "@/lib/server/generation/context";
import { startRun } from "@/lib/server/generation/request";
import type { Json } from "@/lib/supabase/database.types";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export type ActionState = { error?: string; message?: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function str(form: FormData, key: string): string {
  return String(form.get(key) ?? "").trim();
}

async function requestRun(options: {
  kind: "concept_batch" | "concept_regen";
  founderId: string;
  month: string;
  count: number;
  nonce: string;
  replacing: { conceptId: string; guidance: string } | null;
}): Promise<ActionState> {
  const supabase = await createSupabaseServerClient();
  const { data: founder } = await supabase
    .from("founders")
    .select("company_id")
    .eq("id", options.founderId)
    .maybeSingle();
  if (!founder) return { error: "Founder not found." };

  let refs: ConceptRefs;
  let promptLength: number;
  try {
    refs = await resolveConceptRefs(supabase, founder.company_id, options.founderId, options.month);
    const input = await buildConceptInput(
      supabase,
      founder.company_id,
      options.founderId,
      options.month,
      refs,
      options.count,
      options.replacing,
    );
    promptLength = promptText({ ...buildConceptPrompt(input), untrustedContext: [] }).length;
  } catch (error) {
    if (error instanceof MissingInputError) return { error: error.message };
    throw error;
  }

  const model = llmModels().draft;
  const estimate = estimateMaxCost(model, promptLength, CONCEPTS_MAX_OUTPUT_TOKENS);
  const result = await startRun({
    kind: options.kind,
    founderId: options.founderId,
    month: options.month,
    model,
    template: CONCEPTS_TEMPLATE,
    templateVersion: CONCEPTS_VERSION,
    refs: refs as unknown as Json,
    params: {
      count: options.count,
      ...(options.replacing ? { concept_id: options.replacing.conceptId, guidance: options.replacing.guidance } : {}),
    },
    estimate,
    keyParts: [refs.brief_version_id, options.replacing?.conceptId ?? "", options.nonce],
  });
  revalidatePath("/admin/concepts");
  revalidatePath("/admin/ai");
  return result;
}

export async function requestConceptsAction(_state: ActionState, form: FormData): Promise<ActionState> {
  await requireAdmin();
  const founderId = str(form, "founder_id");
  const month = str(form, "month");
  const count = Number(form.get("count"));
  if (!UUID.test(founderId) || !isIsoMonth(month)) return { error: "Choose a founder and month." };
  if (!Number.isInteger(count) || count < 1 || count > MAX_CONCEPTS_PER_RUN)
    return { error: `Ask for 1 to ${MAX_CONCEPTS_PER_RUN} concepts.` };
  return requestRun({ kind: "concept_batch", founderId, month, count, nonce: str(form, "nonce"), replacing: null });
}

export async function regenerateConceptAction(_state: ActionState, form: FormData): Promise<ActionState> {
  await requireAdmin();
  const conceptId = str(form, "concept_id");
  if (!UUID.test(conceptId)) return { error: "Concept not found." };
  const supabase = await createSupabaseServerClient();
  const { data: concept } = await supabase
    .from("concepts")
    .select("founder_id, target_month, status")
    .eq("id", conceptId)
    .maybeSingle();
  if (!concept || !["proposed", "selected", "rejected"].includes(concept.status))
    return { error: "This concept can't be regenerated." };
  return requestRun({
    kind: "concept_regen",
    founderId: concept.founder_id,
    month: concept.target_month.slice(0, 7),
    count: 1,
    nonce: str(form, "nonce"),
    replacing: { conceptId, guidance: str(form, "guidance").slice(0, 500) },
  });
}

export async function setConceptStatusAction(_state: ActionState, form: FormData): Promise<ActionState> {
  await requireAdmin();
  const status = str(form, "status");
  if (!["proposed", "selected", "rejected"].includes(status)) return { error: "Unknown action." };
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc("set_concept_status", {
    p_concept_id: str(form, "concept_id"),
    p_status: status as "proposed" | "selected" | "rejected",
  });
  if (error) return { error: "Not saved. Reload the page." };
  revalidatePath("/admin/concepts");
  return {};
}

export async function updateConceptAction(_state: ActionState, form: FormData): Promise<ActionState> {
  await requireAdmin();
  const title = str(form, "title");
  const coreArgument = str(form, "core_argument");
  const format = str(form, "format");
  if (!title || title.length > 200) return { error: "The title must be 1 to 200 characters." };
  if (!coreArgument || coreArgument.length > 1000) return { error: "The core argument must be 1 to 1,000 characters." };
  if (!isPostFormat(format)) return { error: "Choose a format." };
  const evidence = lines(form.get("evidence_requirements"));
  if (evidence.length > 10 || evidence.some((e) => e.length > 300)) return { error: "Up to 10 evidence lines." };
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc("update_concept", {
    p_concept_id: str(form, "concept_id"),
    p_title: title,
    p_audience: str(form, "audience").slice(0, 300),
    p_core_argument: coreArgument,
    p_hook: str(form, "hook").slice(0, 500),
    p_format: format,
    p_why_this_founder: str(form, "why_this_founder").slice(0, 1000),
    p_evidence_requirements: evidence,
  });
  if (error) return { error: "Not saved. Only proposed or selected concepts can be edited." };
  revalidatePath("/admin/concepts");
  return { message: "Saved." };
}
