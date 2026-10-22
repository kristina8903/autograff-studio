import "server-only";
// The job runner's storage: the secret-key client, because runs execute
// without a user session (after the response, or from the cron tick). Every
// function here is reached either through runGenerationNow (which checks the
// admin first) or through runDueGenerations (only from /api/jobs/tick, which
// checks CRON_SECRET first).

import { requireAdmin } from "@/lib/auth/dal";
import { isIsoDate } from "@/lib/domain/dates";
import { llmProvider } from "@/lib/providers/llm";
import {
  buildConceptInput,
  buildDraftInput,
  MissingInputError,
  type ConceptRefs,
} from "@/lib/server/generation/context";
import type { RepetitionCandidate } from "@/lib/prompts/repetition-judge.v1";
import {
  processDueRuns,
  processRun,
  RunInputError,
  type ClaimedRun,
  type RunStore,
} from "@/lib/server/generation/runner";
import type { Database, Json } from "@/lib/supabase/database.types";
import { createSupabaseAdminClient } from "./client";

type RunRow = Database["public"]["Tables"]["generation_runs"]["Row"];

function createRunStore(): RunStore {
  const db = createSupabaseAdminClient();
  const rows = new Map<string, RunRow>();

  return {
    async claim(runId) {
      const { data, error } = await db.rpc("claim_generation_run", runId ? { p_run_id: runId } : {});
      if (error) throw error;
      const row = (data ?? [])[0];
      if (!row) return null;
      rows.set(row.id, row);
      return {
        id: row.id,
        kind: row.kind,
        model: row.model,
        attempt: row.attempt,
        params: (row.params ?? {}) as Record<string, unknown>,
      } satisfies ClaimedRun;
    },

    async conceptInput(run) {
      const row = rows.get(run.id)!;
      const month = row.target_month?.slice(0, 7);
      if (!row.founder_id || !month || !isIsoDate(`${month}-01`))
        throw new RunInputError("The run has no founder or month.");
      const conceptId = typeof run.params.concept_id === "string" ? run.params.concept_id : null;
      try {
        return await buildConceptInput(
          db,
          row.company_id,
          row.founder_id,
          month,
          row.input_refs as unknown as ConceptRefs,
          Number(run.params.count ?? 1),
          conceptId ? { conceptId, guidance: String(run.params.guidance ?? "") } : null,
        );
      } catch (error) {
        if (error instanceof MissingInputError) throw new RunInputError(error.message);
        throw error;
      }
    },

    async completeConcepts(runId, servedModel, usage, concepts) {
      const { data, error } = await db.rpc("complete_concept_run", {
        p_run_id: runId,
        p_served_model: servedModel,
        p_usage: usageJson(usage),
        p_concepts: concepts as unknown as Json,
      });
      if (error) throw error;
      return data;
    },

    async draftInput(run) {
      const row = rows.get(run.id)!;
      const draftId = typeof run.params.draft_id === "string" ? run.params.draft_id : null;
      let conceptId = typeof run.params.concept_id === "string" ? run.params.concept_id : null;
      if (draftId && !conceptId) {
        const { data } = await db
          .from("drafts")
          .select("concept_id")
          .eq("id", draftId)
          .eq("company_id", row.company_id)
          .maybeSingle();
        conceptId = data?.concept_id ?? null;
      }
      if (!conceptId) throw new RunInputError("The draft has no concept to write from.");
      try {
        return await buildDraftInput(
          db,
          row.company_id,
          row.input_refs as unknown as ConceptRefs,
          { conceptId, draftId, guidance: String(run.params.guidance ?? "") },
          String(run.params.judge_model ?? run.model),
        );
      } catch (error) {
        if (error instanceof MissingInputError) throw new RunInputError(error.message);
        throw error;
      }
    },

    async repetitionCandidates(run, text, argumentKey) {
      const row = rows.get(run.id)!;
      const { data, error } = await db.rpc("repetition_candidates", {
        p_company_id: row.company_id,
        p_text: text,
        p_argument_key: argumentKey,
        p_month: row.target_month!,
        p_exclude_draft_id: (typeof run.params.draft_id === "string" ? run.params.draft_id : null) as string,
        p_exclude_concept_id: (typeof run.params.concept_id === "string" ? run.params.concept_id : null) as string,
      });
      if (error) throw error;
      return (data ?? []) as RepetitionCandidate[];
    },

    async completeDraft(runId, servedModel, usage, payload) {
      const { error } = await db.rpc("complete_draft_run", {
        p_run_id: runId,
        p_served_model: servedModel,
        p_usage: usageJson(usage),
        p_payload: payload as unknown as Json,
      });
      if (error) throw error;
    },

    async fail(runId, code, message, retryAfterSeconds, usage) {
      const { data, error } = await db.rpc("fail_generation_run", {
        p_run_id: runId,
        p_error_code: code,
        p_error_message: message,
        p_retry_after_seconds: retryAfterSeconds as number,
        p_usage: usage ? usageJson(usage) : {},
      });
      if (error) throw error;
      return data as "queued" | "failed";
    },
  };
}

function usageJson(usage: {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  costUsd: number;
}): Json {
  return {
    input_tokens: usage.inputTokens,
    output_tokens: usage.outputTokens,
    cache_read_tokens: usage.cacheReadTokens,
    cache_write_tokens: usage.cacheWriteTokens,
    cost_usd: Number(usage.costUsd.toFixed(6)),
  };
}

/** Runs one just-requested run (called after the admin's request returns). */
export async function runGenerationNow(runId: string) {
  await requireAdmin();
  return processRun(createRunStore(), llmProvider(), runId);
}

/** The cron tick: requeue stuck runs, then work through due ones. Caller must have checked CRON_SECRET. */
export async function runDueGenerations() {
  const db = createSupabaseAdminClient();
  await db.rpc("requeue_stale_runs", {});
  return processDueRuns(createRunStore(), llmProvider());
}
