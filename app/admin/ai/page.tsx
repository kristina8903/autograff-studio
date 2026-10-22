import type { Metadata } from "next";
import { AiSpendCard } from "@/components/ai-spend";
import { AutoRefresh } from "@/components/auto-refresh";
import { Badge, Card, PageHeader } from "@/components/ui";
import { requireAdmin } from "@/lib/auth/dal";
import { usd } from "@/lib/domain/pricing";
import { llmModels, llmProvider } from "@/lib/providers/llm";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "AI usage" };

const KIND_LABEL: Record<string, string> = {
  concept_batch: "Concepts",
  concept_regen: "Concept regenerated",
  draft: "Draft",
  draft_regen: "Draft regenerated",
};
const STATUS_TONE = {
  queued: "accent",
  running: "accent",
  succeeded: "success",
  failed: "danger",
  refused: "danger",
  cancelled: "neutral",
} as const;

export default async function AiUsagePage() {
  await requireAdmin();
  const supabase = await createSupabaseServerClient();
  const monthStart = new Date();
  monthStart.setUTCDate(1);
  monthStart.setUTCHours(0, 0, 0, 0);
  const [{ data: runs }, { data: founders }] = await Promise.all([
    supabase
      .from("generation_runs")
      .select("*")
      .gte("created_at", monthStart.toISOString())
      .order("created_at", { ascending: false })
      .limit(200),
    supabase.from("founders").select("id, display_name"),
  ]);
  const names = Object.fromEntries((founders ?? []).map((f) => [f.id, f.display_name]));
  const provider = llmProvider().name;
  const models = llmModels();
  const active = (runs ?? []).some((r) => r.status === "queued" || r.status === "running");

  return (
    <>
      <AutoRefresh active={active} />
      <PageHeader
        title="AI usage"
        description="Every AI run this month: what it was based on, which model answered, and what it cost. Runs over a ceiling are refused before any call is made."
      />
      <AiSpendCard />
      <Card className="mb-6 text-sm">
        <p>
          Provider:{" "}
          {provider === "fake" ? (
            <>
              <Badge>fake</Badge>{" "}
              <span className="text-muted">
                No AI calls are made. Set LLM_PROVIDER=anthropic and ANTHROPIC_API_KEY to switch.
              </span>
            </>
          ) : (
            <Badge tone="success">Anthropic</Badge>
          )}
        </p>
        <p className="mt-1 text-muted">
          Concepts and drafts: {models.draft} · Checks: {models.extract}. The ceilings are kept in the database and
          can&apos;t be raised from the app.
        </p>
      </Card>
      <Card className="overflow-x-auto p-0">
        <table aria-label="Runs" className="w-full text-left text-sm">
          <thead className="border-b border-border text-xs text-muted">
            <tr>
              <th className="px-4 py-2 font-medium">When</th>
              <th className="px-4 py-2 font-medium">Run</th>
              <th className="px-4 py-2 font-medium">Based on</th>
              <th className="px-4 py-2 font-medium">Model</th>
              <th className="px-4 py-2 font-medium">Tokens in / out</th>
              <th className="px-4 py-2 font-medium">Cost</th>
              <th className="px-4 py-2 font-medium">Status</th>
            </tr>
          </thead>
          <tbody>
            {(runs ?? []).map((run) => {
              const refs = run.input_refs as {
                brief_version_id?: string;
                voice_profile_version_id?: string | null;
                example_ids?: string[];
              };
              return (
                <tr key={run.id} className="border-b border-border align-top last:border-0">
                  <td className="px-4 py-2 whitespace-nowrap">
                    {new Date(run.created_at).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" })}
                  </td>
                  <td className="px-4 py-2">
                    {KIND_LABEL[run.kind] ?? run.kind}
                    <span className="block text-xs text-muted">
                      {run.founder_id ? names[run.founder_id] : ""}
                      {run.params && typeof run.params === "object" && "count" in run.params
                        ? ` · ${String(run.params.count)}`
                        : ""}
                    </span>
                  </td>
                  <td className="px-4 py-2 text-xs text-muted">
                    {refs.brief_version_id ? "brief" : ""}
                    {refs.voice_profile_version_id ? " · voice profile" : " · no voice profile"}
                    {` · ${refs.example_ids?.length ?? 0} examples`}
                    <span className="block">
                      {run.prompt_template} v{run.prompt_template_version}
                    </span>
                  </td>
                  <td className="px-4 py-2 text-xs">
                    {run.served_model && run.served_model !== run.model ? (
                      <>
                        {run.served_model} <span className="text-muted">(asked {run.model})</span>
                      </>
                    ) : (
                      run.model
                    )}
                    {run.provider === "fake" ? <span className="block text-muted">fake</span> : null}
                  </td>
                  <td className="px-4 py-2 text-xs">
                    {run.input_tokens.toLocaleString("en-US")} / {run.output_tokens.toLocaleString("en-US")}
                    {run.cache_read_tokens ? (
                      <span className="block text-muted">{run.cache_read_tokens.toLocaleString("en-US")} cached</span>
                    ) : null}
                  </td>
                  <td className="px-4 py-2 text-xs">
                    {run.actual_cost_usd !== null ? usd(Number(run.actual_cost_usd)) : "—"}
                    <span className="block text-muted">max {usd(Number(run.estimated_cost_usd))}</span>
                  </td>
                  <td className="px-4 py-2">
                    <Badge tone={STATUS_TONE[run.status]}>{run.status}</Badge>
                    {run.attempt > 1 ? <span className="ml-1 text-xs text-muted">attempt {run.attempt}</span> : null}
                    {run.error_message ? <span className="block text-xs text-danger">{run.error_message}</span> : null}
                  </td>
                </tr>
              );
            })}
            {runs?.length ? null : (
              <tr>
                <td colSpan={7} className="px-4 py-6 text-center text-muted">
                  No AI runs this month.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </Card>
    </>
  );
}
