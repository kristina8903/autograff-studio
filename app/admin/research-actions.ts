"use server";
// Web research (Phase 5): requesting a run, and the admin's review of what it
// found. Every write is a database function that checks the admin; nothing a
// source says is trusted until a person accepts the source and verifies the
// finding.

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth/dal";
import { isIsoMonth } from "@/lib/domain/dates";
import { estimateMaxCost } from "@/lib/domain/pricing";
import { MAX_EXCERPT_CHARACTERS, MAX_SEARCHES_PER_RUN, WEB_SEARCH_USD, parseDomainList } from "@/lib/domain/research";
import { FINDINGS_MAX_OUTPUT_TOKENS, FINDINGS_TEMPLATE, FINDINGS_VERSION } from "@/lib/prompts/findings.v1";
import { llmModels } from "@/lib/providers/llm";
import { researchProvider } from "@/lib/providers/research";
import { startRun } from "@/lib/server/generation/request";
import type { Database } from "@/lib/supabase/database.types";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export type ActionState = { error?: string; message?: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
type SourceStatus = Database["public"]["Enums"]["source_status"];
type SourceTier = Database["public"]["Enums"]["source_tier"];
type FindingStatus = Database["public"]["Enums"]["finding_status"];
const SOURCE_STATUSES: SourceStatus[] = ["candidate", "accepted", "rejected"];
const TIERS: SourceTier[] = ["primary", "reputable_publication", "secondary", "discussion", "unknown"];
const FINDING_ACTIONS: FindingStatus[] = ["human_verified", "disputed", "rejected", "unverified"];

/** Search results are read as input tokens: about 10,000 tokens a search, with room for the follow-up turns. */
const SEARCH_PROMPT_CHARACTERS = MAX_SEARCHES_PER_RUN * 60_000;
const SEARCH_MAX_OUTPUT_TOKENS = 4_000;
const SOURCES_PER_RUN = 20;

function str(form: FormData, key: string): string {
  return String(form.get(key) ?? "").trim();
}

function refresh() {
  revalidatePath("/admin/research");
  revalidatePath("/admin/ai");
}

/** The most a research run can cost: the searches, the search model's tokens, and the extraction. */
function researchEstimate(model: string): number {
  return (
    MAX_SEARCHES_PER_RUN * WEB_SEARCH_USD +
    estimateMaxCost(model, SEARCH_PROMPT_CHARACTERS, SEARCH_MAX_OUTPUT_TOKENS) +
    estimateMaxCost(model, SOURCES_PER_RUN * MAX_EXCERPT_CHARACTERS + 4_000, FINDINGS_MAX_OUTPUT_TOKENS)
  );
}

export async function requestResearchAction(_state: ActionState, form: FormData): Promise<ActionState> {
  await requireAdmin();
  const month = str(form, "month");
  const query = str(form, "query");
  const conceptId = str(form, "concept_id");
  if (!isIsoMonth(month)) return { error: "Choose a month." };
  if (query.length < 3 || query.length > 300) return { error: "Write a research question of 3 to 300 characters." };
  if (conceptId && !UUID.test(conceptId)) return { error: "Concept not found." };
  const model = llmModels().extract;
  const result = await startRun({
    kind: "research",
    founderId: null,
    month,
    model,
    provider: researchProvider().name,
    template: FINDINGS_TEMPLATE,
    templateVersion: FINDINGS_VERSION,
    refs: {},
    params: { query, ...(conceptId ? { concept_id: conceptId } : {}) },
    estimate: researchEstimate(model),
    keyParts: [query, conceptId, str(form, "nonce")],
  });
  refresh();
  return result;
}

export async function reviewSourceAction(_state: ActionState, form: FormData): Promise<ActionState> {
  await requireAdmin();
  const status = str(form, "status") as SourceStatus;
  const tier = str(form, "tier") as SourceTier;
  if (!SOURCE_STATUSES.includes(status) || !TIERS.includes(tier)) return { error: "Unknown action." };
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc("review_research_source", {
    p_source_id: str(form, "source_id"),
    p_status: status,
    p_tier: tier,
    p_note: str(form, "note").slice(0, 500),
  });
  if (error) return { error: "Not saved. Reload the page." };
  refresh();
  return {
    message: status === "accepted" ? "Source accepted." : status === "rejected" ? "Source rejected." : "Saved.",
  };
}

export async function reviewFindingAction(_state: ActionState, form: FormData): Promise<ActionState> {
  await requireAdmin();
  const status = str(form, "status") as FindingStatus;
  if (!FINDING_ACTIONS.includes(status)) return { error: "Unknown action." };
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc("review_research_finding", {
    p_finding_id: str(form, "finding_id"),
    p_status: status,
    p_note: str(form, "note").slice(0, 500),
  });
  if (error)
    return {
      error:
        error.code === "22023" ? error.message.charAt(0).toUpperCase() + error.message.slice(1) + "." : "Not saved.",
    };
  refresh();
  return {};
}

export async function linkFindingsAction(_state: ActionState, form: FormData): Promise<ActionState> {
  await requireAdmin();
  const a = str(form, "finding_id");
  const b = str(form, "other_id");
  if (!UUID.test(a) || !UUID.test(b)) return { error: "Choose a finding." };
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc("link_research_findings", {
    p_a: a,
    p_b: b,
    p_conflict: form.get("conflict") !== "false",
  });
  if (error) return { error: "Not saved. Reload the page." };
  refresh();
  return {};
}

export async function saveDomainsAction(_state: ActionState, form: FormData): Promise<ActionState> {
  await requireAdmin();
  const allowed = parseDomainList(str(form, "allowed"));
  const blocked = parseDomainList(str(form, "blocked"));
  const invalid = [...allowed.invalid, ...blocked.invalid];
  if (invalid.length) return { error: `Not domains: ${invalid.slice(0, 5).join(", ")}.` };
  if (allowed.domains.length > 64 || blocked.domains.length > 64) return { error: "At most 64 domains in each list." };
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc("set_research_domains", {
    p_allowed: allowed.domains,
    p_blocked: blocked.domains,
  });
  if (error) return { error: "Not saved. Reload the page." };
  refresh();
  return { message: "Domain lists saved." };
}
