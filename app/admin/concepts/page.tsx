import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AiSpendCard } from "@/components/ai-spend";
import { AutoRefresh } from "@/components/auto-refresh";
import { Alert, Badge, Card, PageHeader, cx } from "@/components/ui";
import { requireAdmin } from "@/lib/auth/dal";
import {
  addMonths,
  firstDayOfMonth,
  isIsoMonth,
  lastDayOfMonth,
  localToday,
  monthLabel,
  monthOf,
} from "@/lib/domain/dates";
import { formatLabel } from "@/lib/domain/formats";
import { MAX_CONCEPTS_PER_RUN } from "@/lib/prompts/concepts.v1";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { WriteDraftForm } from "../drafts/draft-forms";
import { EditConceptForm, GenerateForm, RegenerateForm, StatusButtons } from "./concept-forms";

export const metadata: Metadata = { title: "Concepts" };
// Server Actions on this page start AI runs that finish after the response.
export const maxDuration = 300;

/** Concepts asked for per batch when the cadence leaves room (DATA_MODEL §12.4). */
const BATCH_SIZE = 8;

const STATUS_TONE = {
  proposed: "accent",
  selected: "success",
  rejected: "neutral",
  drafted: "success",
  archived: "neutral",
} as const;

export default async function ConceptsPage({ searchParams }: PageProps<"/admin/concepts">) {
  await requireAdmin();
  const params = await searchParams;
  const month = typeof params.month === "string" ? params.month : addMonths(monthOf(localToday("UTC")), 1);
  if (!isIsoMonth(month)) notFound();
  const showAll = params.all === "1";

  const supabase = await createSupabaseServerClient();
  const [{ data: founders }, { data: rules }, { data: concepts }, { data: runs }, { data: drafts }] = await Promise.all(
    [
      supabase.from("founders").select("id, display_name, role_title").eq("active", true).order("created_at"),
      supabase
        .from("cadence_rules")
        .select("founder_id, effective_from, effective_to, candidate_target_min, candidate_target_max")
        .lte("effective_from", lastDayOfMonth(month))
        .order("effective_from"),
      supabase
        .from("concepts")
        .select("*, run:generation_runs(model, served_model)")
        .eq("target_month", firstDayOfMonth(month))
        .order("created_at"),
      supabase
        .from("generation_runs")
        .select("id, founder_id, kind, status, error_message, created_at")
        .eq("target_month", firstDayOfMonth(month))
        .in("kind", ["concept_batch", "concept_regen", "draft"])
        .order("created_at", { ascending: false })
        .limit(50),
      supabase.from("drafts").select("id, concept_id").eq("target_month", firstDayOfMonth(month)),
    ],
  );
  const draftsOf = (conceptId: string) => (drafts ?? []).filter((d) => d.concept_id === conceptId);
  const active = (runs ?? []).some((r) => r.status === "queued" || r.status === "running");

  return (
    <>
      <AutoRefresh active={active} />
      <PageHeader
        title="Concepts"
        description="Angles for each founder's posts this month. Select the ones worth drafting; reject or regenerate the rest. Founders don't see concepts."
        actions={
          <div className="flex items-center gap-3 text-sm">
            <Link
              href={`/admin/concepts?month=${addMonths(month, -1)}`}
              className="text-muted hover:text-foreground"
              aria-label="Previous month"
            >
              ←
            </Link>
            <span className="font-medium">{monthLabel(month)}</span>
            <Link
              href={`/admin/concepts?month=${addMonths(month, 1)}`}
              className="text-muted hover:text-foreground"
              aria-label="Next month"
            >
              →
            </Link>
          </div>
        }
      />
      <AiSpendCard />
      <p className="mb-4 text-sm">
        <Link href={`/admin/concepts?month=${month}${showAll ? "" : "&all=1"}`} className="text-accent hover:underline">
          {showAll ? "Hide rejected and replaced concepts" : "Show rejected and replaced concepts"}
        </Link>
      </p>

      {(founders ?? []).map((founder) => {
        const rule = (rules ?? [])
          .filter((r) => r.founder_id === founder.id && (!r.effective_to || r.effective_to > firstDayOfMonth(month)))
          .at(-1);
        const own = (concepts ?? []).filter((c) => c.founder_id === founder.id);
        const live = own.filter((c) => c.status === "proposed" || c.status === "selected");
        const need = rule ? Math.max(0, rule.candidate_target_max - live.length) : 0;
        const shown = showAll ? own : own.filter((c) => c.status !== "rejected" && c.status !== "archived");
        const founderRuns = (runs ?? []).filter((r) => r.founder_id === founder.id);
        const running = founderRuns.filter((r) => r.status === "queued" || r.status === "running");
        const lastProblem = founderRuns.find((r) => r.status === "failed" || r.status === "refused");
        return (
          <section key={founder.id} aria-label={`Concepts for ${founder.display_name}`} className="mb-8">
            <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
              <h2 className="text-lg font-semibold">
                {founder.display_name} <span className="text-sm font-normal text-muted">({founder.role_title})</span>
              </h2>
              <p className="text-sm text-muted">
                {rule
                  ? `${live.length} live · target ${rule.candidate_target_min}–${rule.candidate_target_max} candidates`
                  : "No cadence set"}
              </p>
            </div>
            <Card className="mb-3">
              {need === 0 && rule ? (
                <p className="mb-3 text-sm text-muted">
                  Supply is sufficient for this month. You can still generate more.
                </p>
              ) : null}
              <GenerateForm
                founderId={founder.id}
                founderName={founder.display_name}
                month={month}
                suggested={Math.min(need || 1, BATCH_SIZE)}
                max={MAX_CONCEPTS_PER_RUN}
                nonce={crypto.randomUUID()}
              />
              {running.length ? (
                <p className="mt-3 text-sm text-muted" role="status">
                  Generating… ({running.length} run{running.length === 1 ? "" : "s"} in progress)
                </p>
              ) : null}
              {lastProblem && !running.length ? (
                <div className="mt-3">
                  <Alert tone="error">
                    Last run {lastProblem.status === "refused" ? "was refused" : "failed"}: {lastProblem.error_message}{" "}
                    <Link href="/admin/ai" className="underline">
                      AI usage
                    </Link>
                  </Alert>
                </div>
              ) : null}
            </Card>

            <ol aria-label={`${founder.display_name}'s concepts`} className="space-y-3">
              {shown.map((concept) => (
                <li key={concept.id}>
                  <Card
                    className={cx(concept.status === "rejected" || concept.status === "archived" ? "opacity-60" : "")}
                  >
                    <div className="mb-2 flex flex-wrap items-center gap-2 text-xs text-muted">
                      <Badge tone={STATUS_TONE[concept.status]}>
                        {concept.status === "archived" ? "replaced" : concept.status}
                      </Badge>
                      <span>{formatLabel(concept.format)}</span>
                      {concept.needs_personal_story ? <Badge tone="accent">needs a personal story</Badge> : null}
                      {concept.edited_at ? <span>· edited</span> : null}
                      {concept.run ? <span>· {concept.run.served_model ?? concept.run.model}</span> : null}
                    </div>
                    <h3 className="font-semibold">{concept.title}</h3>
                    <p className="mt-1 text-sm">{concept.core_argument}</p>
                    <dl className="mt-2 grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
                      {concept.hook ? (
                        <div>
                          <dt className="text-xs text-muted">Hook</dt>
                          <dd>{concept.hook}</dd>
                        </div>
                      ) : null}
                      {concept.audience ? (
                        <div>
                          <dt className="text-xs text-muted">Audience</dt>
                          <dd>{concept.audience}</dd>
                        </div>
                      ) : null}
                      {concept.why_this_founder ? (
                        <div>
                          <dt className="text-xs text-muted">Why this founder</dt>
                          <dd>{concept.why_this_founder}</dd>
                        </div>
                      ) : null}
                      {concept.evidence_requirements.length ? (
                        <div>
                          <dt className="text-xs text-muted">Evidence needed</dt>
                          <dd>
                            <ul className="list-disc pl-5">
                              {concept.evidence_requirements.map((e) => (
                                <li key={e}>{e}</li>
                              ))}
                            </ul>
                          </dd>
                        </div>
                      ) : null}
                    </dl>
                    {concept.status !== "archived" ? (
                      <div className="mt-3 flex flex-wrap items-start gap-2">
                        {concept.status === "selected" || concept.status === "drafted" ? (
                          <WriteDraftForm
                            conceptId={concept.id}
                            nonce={crypto.randomUUID()}
                            label={concept.status === "drafted" ? "Write another draft" : "Write a draft"}
                          />
                        ) : null}
                        {concept.status !== "drafted" ? (
                          <>
                            <StatusButtons conceptId={concept.id} status={concept.status} />
                            {concept.status !== "rejected" ? <EditConceptForm concept={concept} /> : null}
                            <RegenerateForm conceptId={concept.id} nonce={crypto.randomUUID()} />
                          </>
                        ) : null}
                        {draftsOf(concept.id).map((d, i) => (
                          <Link
                            key={d.id}
                            href={`/admin/drafts/${d.id}`}
                            className="self-center text-xs text-accent hover:underline"
                          >
                            Draft {i + 1}
                          </Link>
                        ))}
                      </div>
                    ) : null}
                  </Card>
                </li>
              ))}
              {shown.length ? null : <li className="text-sm text-muted">No concepts yet.</li>}
            </ol>
          </section>
        );
      })}
    </>
  );
}
