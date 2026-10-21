"use server";

import { createHash } from "node:crypto";
import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { requireAdmin } from "@/lib/auth/dal";
import { isIsoMonth } from "@/lib/domain/dates";
import { isPostFormat } from "@/lib/domain/formats";
import { estimateMaxCost, usd } from "@/lib/domain/pricing";
import { lines } from "@/lib/domain/briefs";
import {
  CONCEPTS_MAX_OUTPUT_TOKENS,
  CONCEPTS_TEMPLATE,
  CONCEPTS_VERSION,
  MAX_CONCEPTS_PER_RUN,
  buildConceptPrompt,
} from "@/lib/prompts/concepts.v1";
import { llmModels, llmProvider } from "@/lib/providers/llm";
import { promptText } from "@/lib/providers/llm/types";
import { runGenerationNow } from "@/lib/server/admin/generation";
import {
  MissingInputError,
  buildConceptInput,
  resolveConceptRefs,
  type ConceptRefs,
} from "@/lib/server/generation/context";
import type { Json } from "@/lib/supabase/database.types";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export type ActionState = { error?: string; message?: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function str(form: FormData, key: string): string {
  return String(form.get(key) ?? "").trim();
}

/** Same click (same form nonce) and same inputs → same key → one run (SECURITY §10). */
function idempotencyKey(parts: string[]): string {
  return createHash("sha256").update(parts.join("|")).digest("hex");
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
  const { data, error } = await supabase.rpc("request_generation", {
    p_kind: options.kind,
    p_founder_id: options.founderId,
    p_target_month: `${options.month}-01`,
    p_provider: llmProvider().name,
    p_model: model,
    p_prompt_template: CONCEPTS_TEMPLATE,
    p_prompt_template_version: CONCEPTS_VERSION,
    p_input_refs: refs as unknown as Json,
    p_params: {
      count: options.count,
      ...(options.replacing ? { concept_id: options.replacing.conceptId, guidance: options.replacing.guidance } : {}),
    },
    p_estimated_cost_usd: Number(estimate.toFixed(6)),
    p_idempotency_key: idempotencyKey([
      options.kind,
      options.founderId,
      options.month,
      refs.brief_version_id,
      options.replacing?.conceptId ?? "",
      options.nonce,
    ]),
  });
  if (error) return { error: "The run could not be requested." };
  const run = data[0];
  revalidatePath("/admin/concepts");
  revalidatePath("/admin/ai");
  if (run.run_status === "refused") return { error: `Not started. ${run.message}` };
  if (run.message === "already requested") return { message: "Already requested; it is running." };
  after(async () => {
    try {
      await runGenerationNow(run.run_id);
    } catch (e) {
      // The cron tick retries it; log the type only, never content.
      console.error("generation run did not start", run.run_id, e instanceof Error ? e.name : typeof e);
    }
  });
  return { message: `Generating. This run can cost up to ${usd(estimate)}.` };
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
