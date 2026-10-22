import "server-only";
// Gathers what a concept run is based on. At request time it picks the
// versions (current brief and voice versions, retrieved examples) and records
// their ids on the run; at run time the same ids are read back, so the run
// uses exactly what was recorded, even if the brief changed in between.

import type { SupabaseClient } from "@supabase/supabase-js";
import { readSnapshot } from "@/lib/domain/briefs";
import { localToday, monthLabel, type IsoMonth } from "@/lib/domain/dates";
import { retrieveExamples } from "@/lib/domain/retrieval";
import { readVoiceVersion } from "@/lib/domain/voice";
import type { ConceptPromptInput } from "@/lib/prompts/concepts.v1";
import { buildVoiceContext } from "@/lib/prompts/voice-context.v1";
import { EXAMPLE_COLUMNS, toRetrievable } from "@/lib/server/voice";
import type { Database } from "@/lib/supabase/database.types";

type Db = SupabaseClient<Database>;

export type ConceptRefs = {
  brief_version_id: string;
  voice_profile_version_id: string | null;
  example_ids: string[];
};

export class MissingInputError extends Error {}

const LIVE_STATUSES = ["proposed", "selected", "drafted"] as const;

/** The current brief and voice versions and the best-matching examples, for a new run. */
export async function resolveConceptRefs(
  db: Db,
  companyId: string,
  founderId: string,
  month: IsoMonth,
): Promise<ConceptRefs> {
  const [{ data: brief }, { data: profile }, { data: founder }] = await Promise.all([
    db
      .from("monthly_briefs")
      .select("current:brief_versions!monthly_briefs_current_version_fk(id, content, founder_emphasis, approved_facts)")
      .eq("company_id", companyId)
      .eq("month", `${month}-01`)
      .maybeSingle(),
    db
      .from("voice_profiles")
      .select("current:voice_profile_versions!voice_profiles_current_version_fk(id, expertise_topics)")
      .eq("company_id", companyId)
      .eq("founder_id", founderId)
      .maybeSingle(),
    db.from("founders").select("timezone").eq("company_id", companyId).eq("id", founderId).maybeSingle(),
  ]);
  if (!brief?.current) throw new MissingInputError(`Write the ${monthLabel(month)} brief first.`);
  if (!founder) throw new MissingInputError("Founder not found.");

  const { data: examples } = await db
    .from("writing_examples")
    .select(EXAMPLE_COLUMNS)
    .eq("company_id", companyId)
    .eq("founder_id", founderId)
    .eq("approved_for_voice", true)
    .eq("eval_holdout", false);
  const snapshot = readSnapshot(brief.current);
  const retrieved = retrieveExamples((examples ?? []).map(toRetrievable), {
    founderId,
    format: null,
    topics: profile?.current?.expertise_topics ?? [],
    text: [snapshot.content.theme, snapshot.founderEmphasis[founderId] ?? "", ...snapshot.content.coreArguments].join(
      " ",
    ),
    today: localToday(founder.timezone),
  });
  return {
    brief_version_id: brief.current.id,
    voice_profile_version_id: profile?.current?.id ?? null,
    example_ids: retrieved.map((r) => r.example.id),
  };
}

/** The prompt input for recorded refs, plus the concepts that exist now. */
export async function buildConceptInput(
  db: Db,
  companyId: string,
  founderId: string,
  month: IsoMonth,
  refs: ConceptRefs,
  count: number,
  replacing: { conceptId: string; guidance: string } | null = null,
): Promise<ConceptPromptInput> {
  const [{ data: founder }, { data: brief }, { data: voice }, { data: examples }, { data: concepts }] =
    await Promise.all([
      db
        .from("founders")
        .select("display_name, role_title")
        .eq("company_id", companyId)
        .eq("id", founderId)
        .maybeSingle(),
      db
        .from("brief_versions")
        .select("version_no, content, founder_emphasis, approved_facts")
        .eq("company_id", companyId)
        .eq("id", refs.brief_version_id)
        .maybeSingle(),
      refs.voice_profile_version_id
        ? db
            .from("voice_profile_versions")
            .select("*")
            .eq("company_id", companyId)
            .eq("id", refs.voice_profile_version_id)
            .maybeSingle()
        : Promise.resolve({ data: null }),
      refs.example_ids.length
        ? db
            .from("writing_examples")
            .select("id, body, format, published_at")
            .eq("company_id", companyId)
            .in("id", refs.example_ids)
        : Promise.resolve({ data: [] }),
      db
        .from("concepts")
        .select("id, founder_id, title, core_argument, status, founder:founders(role_title)")
        .eq("company_id", companyId)
        .eq("target_month", `${month}-01`)
        .in("status", LIVE_STATUSES),
    ]);
  if (!founder || !brief) throw new MissingInputError("The brief or founder for this run no longer exists.");

  const order = new Map(refs.example_ids.map((id, i) => [id, i]));
  const ordered = [...(examples ?? [])].sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));
  // The concept being replaced may be rejected, so it is not always in the live list.
  let replacedRow = replacing ? (concepts ?? []).find((c) => c.id === replacing.conceptId) : undefined;
  if (replacing && !replacedRow) {
    const { data } = await db
      .from("concepts")
      .select("id, founder_id, title, core_argument, status, founder:founders(role_title)")
      .eq("company_id", companyId)
      .eq("id", replacing.conceptId)
      .maybeSingle();
    replacedRow = data ?? undefined;
  }
  if (replacing && !replacedRow) throw new MissingInputError("The concept to regenerate no longer exists.");

  return {
    founder: { displayName: founder.display_name, roleTitle: founder.role_title },
    founderId,
    monthLabel: monthLabel(month),
    brief: { ...readSnapshot(brief), versionNo: brief.version_no },
    voiceContext: buildVoiceContext({
      founder: { displayName: founder.display_name, roleTitle: founder.role_title },
      profile: voice ? readVoiceVersion(voice) : null,
      profileVersion: voice?.version_no ?? null,
      examples: ordered.map((e) => ({ id: e.id, body: e.body, format: e.format, publishedAt: e.published_at })),
    }),
    existing: (concepts ?? [])
      .filter((c) => c.founder_id === founderId && c.id !== replacing?.conceptId)
      .map((c) => ({ title: c.title, coreArgument: c.core_argument, status: c.status })),
    otherFounders: (concepts ?? [])
      .filter((c) => c.founder_id !== founderId)
      .map((c) => ({ roleTitle: c.founder?.role_title ?? "Founder", title: c.title })),
    count,
    replacing: replacedRow
      ? { title: replacedRow.title, coreArgument: replacedRow.core_argument, guidance: replacing?.guidance ?? "" }
      : null,
  };
}

// ---------------------------------------------------------------------------
// Drafts
// ---------------------------------------------------------------------------

export type DraftRefs = ConceptRefs;

/** A draft keeps its concept's brief version; the voice version is the current one. */
export async function resolveDraftRefs(db: Db, companyId: string, conceptId: string): Promise<DraftRefs> {
  const { data: concept } = await db
    .from("concepts")
    .select("founder_id, brief_version_id, title, core_argument, hook, format, fingerprint, founder:founders(timezone)")
    .eq("company_id", companyId)
    .eq("id", conceptId)
    .maybeSingle();
  if (!concept) throw new MissingInputError("The concept no longer exists.");
  const [{ data: profile }, { data: examples }] = await Promise.all([
    db
      .from("voice_profiles")
      .select("current:voice_profile_versions!voice_profiles_current_version_fk(id)")
      .eq("company_id", companyId)
      .eq("founder_id", concept.founder_id)
      .maybeSingle(),
    db
      .from("writing_examples")
      .select(EXAMPLE_COLUMNS)
      .eq("company_id", companyId)
      .eq("founder_id", concept.founder_id)
      .eq("approved_for_voice", true)
      .eq("eval_holdout", false),
  ]);
  const topics = (concept.fingerprint as { topics?: unknown }).topics;
  const retrieved = retrieveExamples((examples ?? []).map(toRetrievable), {
    founderId: concept.founder_id,
    format: concept.format,
    topics: Array.isArray(topics) ? topics.map(String) : [],
    text: [concept.title, concept.core_argument, concept.hook].join(" "),
    today: localToday(concept.founder?.timezone ?? "UTC"),
  });
  return {
    brief_version_id: concept.brief_version_id,
    voice_profile_version_id: profile?.current?.id ?? null,
    example_ids: retrieved.map((r) => r.example.id),
  };
}

export async function buildDraftInput(
  db: Db,
  companyId: string,
  refs: DraftRefs,
  target: { conceptId: string; draftId: string | null; guidance: string },
  judgeModel: string,
) {
  const [{ data: concept }, { data: brief }, { data: voice }, { data: examples }, { data: draft }] = await Promise.all([
    db
      .from("concepts")
      .select("*, founder:founders(display_name, role_title)")
      .eq("company_id", companyId)
      .eq("id", target.conceptId)
      .maybeSingle(),
    db
      .from("brief_versions")
      .select("version_no, content, founder_emphasis, approved_facts")
      .eq("company_id", companyId)
      .eq("id", refs.brief_version_id)
      .maybeSingle(),
    refs.voice_profile_version_id
      ? db
          .from("voice_profile_versions")
          .select("*")
          .eq("company_id", companyId)
          .eq("id", refs.voice_profile_version_id)
          .maybeSingle()
      : Promise.resolve({ data: null }),
    refs.example_ids.length
      ? db
          .from("writing_examples")
          .select("id, body, format, published_at")
          .eq("company_id", companyId)
          .in("id", refs.example_ids)
      : Promise.resolve({ data: [] }),
    target.draftId
      ? db
          .from("drafts")
          .select("current:draft_versions!drafts_current_version_fk(body)")
          .eq("company_id", companyId)
          .eq("id", target.draftId)
          .maybeSingle()
      : Promise.resolve({ data: null }),
  ]);
  if (!concept?.founder || !brief) throw new MissingInputError("The concept or its brief no longer exists.");
  if (target.draftId && !draft?.current) throw new MissingInputError("The draft to regenerate no longer exists.");

  const snapshot = readSnapshot(brief);
  const profile = voice ? readVoiceVersion(voice) : null;
  const order = new Map(refs.example_ids.map((id, i) => [id, i]));
  const ordered = [...(examples ?? [])].sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));
  const founder = { displayName: concept.founder.display_name, roleTitle: concept.founder.role_title };
  return {
    prompt: {
      founder,
      founderId: concept.founder_id,
      monthLabel: monthLabel(concept.target_month.slice(0, 7)),
      brief: { ...snapshot, versionNo: brief.version_no },
      concept: {
        title: concept.title,
        coreArgument: concept.core_argument,
        hook: concept.hook,
        format: concept.format,
        audience: concept.audience,
        whyThisFounder: concept.why_this_founder,
        evidenceRequirements: concept.evidence_requirements,
        needsPersonalStory: concept.needs_personal_story,
      },
      voiceContext: buildVoiceContext({
        founder,
        profile,
        profileVersion: voice?.version_no ?? null,
        examples: ordered.map((e) => ({ id: e.id, body: e.body, format: e.format, publishedAt: e.published_at })),
      }),
      revising: draft?.current ? { body: draft.current.body, guidance: target.guidance } : null,
    },
    review: {
      approvedFacts: snapshot.approvedFacts,
      avoidPhrases: profile?.avoidPhrases ?? [],
      styleRules: profile?.styleRules ?? [],
    },
    judgeModel,
  };
}
