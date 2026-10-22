import "server-only";
// Requesting a generation run on the admin's behalf: the budget check and
// idempotency happen in the database (request_generation); the run starts
// right after the response, and the cron tick picks up anything missed.

import { createHash } from "node:crypto";
import { after } from "next/server";
import { usd } from "@/lib/domain/pricing";
import { llmProvider } from "@/lib/providers/llm";
import { runGenerationNow } from "@/lib/server/admin/generation";
import type { Database, Json } from "@/lib/supabase/database.types";
import { createSupabaseServerClient } from "@/lib/supabase/server";

type Kind = Database["public"]["Enums"]["generation_kind"];

/** Same click (same form nonce) and same inputs → same key → one run (SECURITY §10). */
export function idempotencyKey(parts: string[]): string {
  return createHash("sha256").update(parts.join("|")).digest("hex");
}

export async function startRun(request: {
  kind: Kind;
  founderId: string | null;
  /** Defaults to the AI provider; research runs name the research provider. */
  provider?: string;
  month: string;
  model: string;
  template: string;
  templateVersion: number;
  refs: Json;
  params: Json;
  estimate: number;
  keyParts: string[];
}): Promise<{ error?: string; message?: string }> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("request_generation", {
    p_kind: request.kind,
    p_founder_id: request.founderId as string,
    p_target_month: `${request.month}-01`,
    p_provider: request.provider ?? llmProvider().name,
    p_model: request.model,
    p_prompt_template: request.template,
    p_prompt_template_version: request.templateVersion,
    p_input_refs: request.refs,
    p_params: request.params,
    p_estimated_cost_usd: Number(request.estimate.toFixed(6)),
    p_idempotency_key: idempotencyKey([request.kind, request.founderId ?? "", request.month, ...request.keyParts]),
  });
  if (error) return { error: "The run could not be requested." };
  const run = data[0];
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
  return { message: `Generating. This run can cost up to ${usd(request.estimate)}.` };
}
