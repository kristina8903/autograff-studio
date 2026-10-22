import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AutoRefresh } from "@/components/auto-refresh";
import { Badge, Card, PageHeader, cx } from "@/components/ui";
import { requireAdmin } from "@/lib/auth/dal";
import { addMonths, firstDayOfMonth, isIsoMonth, localToday, monthLabel, monthOf } from "@/lib/domain/dates";
import { usd } from "@/lib/domain/pricing";
import { dateLabel } from "@/lib/domain/research";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import {
  ConflictForm,
  DomainsForm,
  FindingReviewForm,
  ResearchForm,
  SourceReviewForm,
  UnlinkButton,
} from "./research-forms";

export const metadata: Metadata = { title: "Research" };
export const maxDuration = 300;

const FINDING_STATUS = {
  unverified: { label: "unchecked", tone: "neutral" },
  machine_supported: { label: "in the excerpt", tone: "accent" },
  human_verified: { label: "verified", tone: "success" },
  disputed: { label: "disputed", tone: "danger" },
  rejected: { label: "rejected", tone: "danger" },
} as const;
const SOURCE_STATUS = {
  candidate: { label: "to review", tone: "accent" },
  accepted: { label: "accepted", tone: "success" },
  rejected: { label: "rejected", tone: "danger" },
} as const;
const TIER = {
  primary: "primary",
  reputable_publication: "reputable publication",
  secondary: "secondary",
  discussion: "discussion",
  unknown: "type not rated",
} as const;

type Data = { value?: string; unit?: string | null; population?: string | null; period?: string | null };

function dataText(data: unknown): string | null {
  if (!data || typeof data !== "object") return null;
  const d = data as Data;
  if (!d.value) return null;
  return [`${d.value}${d.unit === "%" ? "%" : d.unit ? ` ${d.unit}` : ""}`, d.population, d.period]
    .filter(Boolean)
    .join(" · ");
}

export default async function ResearchPage({ searchParams }: PageProps<"/admin/research">) {
  await requireAdmin();
  const params = await searchParams;
  const month = typeof params.month === "string" ? params.month : addMonths(monthOf(localToday("UTC")), 1);
  if (!isIsoMonth(month)) notFound();
  const defaultQuery = typeof params.q === "string" ? params.q.slice(0, 300) : "";
  const defaultConcept = typeof params.concept === "string" ? params.concept : "";

  const supabase = await createSupabaseServerClient();
  const [{ data: settings }, { data: concepts }, { data: runs }, { data: queries }] = await Promise.all([
    supabase.from("settings").select("research_allowed_domains, research_blocked_domains").maybeSingle(),
    supabase
      .from("concepts")
      .select("id, title, founder:founders(display_name)")
      .eq("target_month", firstDayOfMonth(month))
      .in("status", ["proposed", "selected", "drafted"])
      .order("created_at"),
    supabase
      .from("generation_runs")
      .select("id, status, error_message, params, created_at")
      .eq("kind", "research")
      .eq("target_month", firstDayOfMonth(month))
      .in("status", ["queued", "running", "failed", "refused"])
      .order("created_at", { ascending: false })
      .limit(10),
    supabase
      .from("research_queries")
      .select(
        "*, concept:concepts(title), run:generation_runs(actual_cost_usd, web_searches), research_sources(*, research_findings(*))",
      )
      .eq("target_month", firstDayOfMonth(month))
      .order("created_at", { ascending: false }),
  ]);
  const active = (runs ?? []).some((r) => r.status === "queued" || r.status === "running");
  const allFindings = (queries ?? []).flatMap((q) => q.research_sources.flatMap((s) => s.research_findings));
  const findingLabel = new Map(allFindings.map((f) => [f.id, f.claim_text]));

  return (
    <>
      <AutoRefresh active={active} />
      <PageHeader
        title="Research"
        description="Evidence for the month's posts, with where it came from. Accept a source and verify a finding before a draft can state it as fact."
        actions={
          <div className="flex items-center gap-3 text-sm">
            <Link
              href={`/admin/research?month=${addMonths(month, -1)}`}
              className="text-muted hover:text-foreground"
              aria-label="Previous month"
            >
              ←
            </Link>
            <span className="font-medium">{monthLabel(month)}</span>
            <Link
              href={`/admin/research?month=${addMonths(month, 1)}`}
              className="text-muted hover:text-foreground"
              aria-label="Next month"
            >
              →
            </Link>
          </div>
        }
      />

      <div className="grid gap-6 lg:grid-cols-[1fr_20rem]">
        <div className="space-y-6">
          <Card>
            <h2 className="mb-3 text-sm font-semibold">Ask a research question</h2>
            <ResearchForm
              month={month}
              nonce={crypto.randomUUID()}
              defaultQuery={defaultQuery}
              defaultConcept={defaultConcept}
              concepts={(concepts ?? []).map((c) => ({
                id: c.id,
                label: `${c.founder?.display_name ?? "Founder"}: ${c.title}`,
              }))}
            />
            {(runs ?? []).length ? (
              <ul aria-label="Research runs" className="mt-4 space-y-1 text-sm">
                {(runs ?? []).map((r) => (
                  <li
                    key={r.id}
                    className={cx(r.status === "failed" || r.status === "refused" ? "text-danger" : "text-muted")}
                  >
                    “{String((r.params as { query?: string }).query ?? "")}”:{" "}
                    {r.status === "queued" || r.status === "running"
                      ? "searching…"
                      : `${r.status === "refused" ? "refused" : "failed"}. ${r.error_message ?? ""}`}
                  </li>
                ))}
              </ul>
            ) : null}
          </Card>

          {(queries ?? []).map((q) => (
            <section key={q.id} aria-label={`Research: ${q.query_text}`} className="space-y-3">
              <div>
                <h2 className="font-semibold">“{q.query_text}”</h2>
                <p className="text-xs text-muted">
                  {q.concept ? `For “${q.concept.title}” · ` : "For any post this month · "}
                  {new Date(q.created_at).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" })} ·{" "}
                  {q.sources_found} new source{q.sources_found === 1 ? "" : "s"}
                  {q.sources_already_stored ? ` · ${q.sources_already_stored} already stored` : ""}
                  {q.findings_rejected
                    ? ` · ${q.findings_rejected} finding${q.findings_rejected === 1 ? "" : "s"} rejected by the checks`
                    : ""}
                  {q.run ? ` · ${q.run.web_searches} searches, ${usd(Number(q.run.actual_cost_usd ?? 0))}` : ""}
                </p>
              </div>
              {q.research_sources.map((s) => (
                <Card key={s.id} className={cx(s.status === "rejected" && "opacity-60")}>
                  <article aria-label={`Source: ${s.title || s.publisher}`}>
                    <div className="flex flex-wrap items-center gap-2">
                      <a
                        href={s.url}
                        target="_blank"
                        rel="noopener noreferrer nofollow"
                        className="font-medium text-accent hover:underline"
                      >
                        {s.title || s.publisher}
                      </a>
                      <Badge tone={SOURCE_STATUS[s.status].tone}>{SOURCE_STATUS[s.status].label}</Badge>
                      <Badge>{TIER[s.source_tier]}</Badge>
                    </div>
                    <p className="mt-1 text-xs text-muted">
                      {s.publisher} · Published or updated:{" "}
                      {s.published_at_precision === "unknown" ? (
                        <span className="text-danger">date unknown</span>
                      ) : (
                        dateLabel(s.published_at, s.published_at_precision)
                      )}
                      {s.page_age_raw && s.published_at_precision !== "unknown" ? ` (“${s.page_age_raw}”)` : ""} ·
                      Retrieved: {dateLabel(s.retrieved_at.slice(0, 10), "day")}
                    </p>
                    <blockquote className="mt-2 whitespace-pre-wrap border-l-2 border-border pl-3 text-sm text-muted">
                      {s.excerpt}
                    </blockquote>
                    {s.review_note ? <p className="mt-1 text-xs">Note: {s.review_note}</p> : null}
                    <SourceReviewForm sourceId={s.id} tier={s.source_tier} status={s.status} />

                    <h3 className="mt-4 text-xs font-semibold text-muted">Findings</h3>
                    {s.research_findings.length ? (
                      <ul aria-label="Findings" className="mt-1 space-y-3">
                        {s.research_findings.map((f) => (
                          <li
                            key={f.id}
                            aria-label={`Finding: ${f.claim_text}`}
                            className="rounded-md border border-border p-3 text-sm"
                          >
                            <div className="flex flex-wrap items-center gap-2">
                              <Badge tone={FINDING_STATUS[f.verification_status].tone}>
                                {FINDING_STATUS[f.verification_status].label}
                              </Badge>
                              <span>{f.claim_text}</span>
                            </div>
                            {f.quote ? <p className="mt-1 text-xs text-muted">Quote: “{f.quote}”</p> : null}
                            {dataText(f.data) ? (
                              <p className="mt-1 text-xs text-muted">Data: {dataText(f.data)}</p>
                            ) : null}
                            <p className="mt-1 text-xs text-muted">
                              Event date: {dateLabel(f.event_date, f.event_date_precision)}
                            </p>
                            {f.notes ? <p className="mt-1 text-xs">Note: {f.notes}</p> : null}
                            {f.conflicts_with.length ? (
                              <p className="mt-1 text-xs text-danger">
                                Conflicts with:{" "}
                                {f.conflicts_with.map((id) => (
                                  <span key={id} className="mr-2">
                                    “{(findingLabel.get(id) ?? "a finding from another month").slice(0, 80)}”{" "}
                                    <UnlinkButton findingId={f.id} otherId={id} />
                                  </span>
                                ))}
                              </p>
                            ) : null}
                            <FindingReviewForm
                              findingId={f.id}
                              status={f.verification_status}
                              sourceAccepted={s.status === "accepted"}
                            />
                            <ConflictForm
                              findingId={f.id}
                              others={allFindings
                                .filter((o) => o.id !== f.id && !f.conflicts_with.includes(o.id))
                                .map((o) => ({ id: o.id, label: o.claim_text }))}
                            />
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="mt-1 text-xs text-muted">No findings passed the checks.</p>
                    )}
                  </article>
                </Card>
              ))}
              {q.research_sources.length ? null : (
                <p className="text-sm text-muted">
                  No new sources. Pages found before are listed under earlier questions.
                </p>
              )}
            </section>
          ))}
          {queries?.length ? null : <p className="text-sm text-muted">No research for {monthLabel(month)} yet.</p>}
        </div>

        <Card className="h-fit">
          <h2 className="mb-3 text-sm font-semibold">Domains</h2>
          <DomainsForm
            allowed={settings?.research_allowed_domains ?? []}
            blocked={settings?.research_blocked_domains ?? []}
          />
        </Card>
      </div>
    </>
  );
}
