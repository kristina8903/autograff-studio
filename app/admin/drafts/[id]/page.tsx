import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AutoRefresh } from "@/components/auto-refresh";
import { Badge, Button, Card, PageHeader, Select, cx } from "@/components/ui";
import { requireAdmin } from "@/lib/auth/dal";
import { monthLabel } from "@/lib/domain/dates";
import { diffWords } from "@/lib/domain/diff";
import { DRAFT_STATUS_LABELS, isEditable, nextStates } from "@/lib/domain/draft-states";
import { usd } from "@/lib/domain/pricing";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { EditDraftForm, FlagForm, RegenerateDraftForm, TransitionButtons } from "../draft-forms";

export const metadata: Metadata = { title: "Draft" };
export const maxDuration = 300;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const AUTHOR = { ai: "AI", admin: "Admin", founder: "Founder" } as const;
const SUPPORT_TONE = {
  supported: "success",
  weak: "accent",
  unsupported: "danger",
  disputed: "danger",
  not_applicable: "neutral",
} as const;
const KIND_LABEL = {
  sourced_fact: "Fact",
  opinion: "Opinion",
  interpretation: "Interpretation",
  founder_experience: "Founder's experience",
} as const;

export default async function DraftPage({ params, searchParams }: PageProps<"/admin/drafts/[id]">) {
  await requireAdmin();
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  const query = await searchParams;

  const supabase = await createSupabaseServerClient();
  const [{ data: draft }, { data: versions }, { data: runs }] = await Promise.all([
    supabase
      .from("drafts")
      .select("*, founder:founders(display_name, role_title), concept:concepts(id, title, core_argument)")
      .eq("id", id)
      .maybeSingle(),
    supabase
      .from("draft_versions")
      .select(
        "*, author:profiles(email), run:generation_runs(model, served_model, actual_cost_usd), draft_claims(*), review_flags(*)",
      )
      .eq("draft_id", id)
      .order("version_no", { ascending: false }),
    supabase
      .from("generation_runs")
      .select("id, status, error_message, created_at")
      .eq("kind", "draft_regen")
      .contains("params", { draft_id: id })
      .order("created_at", { ascending: false })
      .limit(5),
  ]);
  if (!draft || !versions?.length) notFound();

  const current = versions.find((v) => v.id === draft.current_version_id) ?? versions[0];
  const shownNo = typeof query.v === "string" ? Number(query.v) : current.version_no;
  const shown = versions.find((v) => v.version_no === shownNo) ?? current;
  const isCurrent = shown.id === current.id;
  const compareNo = typeof query.compare === "string" ? Number(query.compare) : shown.version_no - 1;
  const compared = versions.find((v) => v.version_no === compareNo && v.id !== shown.id);
  const flags = [...shown.review_flags].sort((a, b) =>
    a.status === b.status ? (a.severity === "blocking" ? -1 : 1) : a.status === "open" ? -1 : 1,
  );
  const openBlocking = flags.filter((f) => f.status === "open" && f.severity === "blocking").length;
  const regenerating = (runs ?? []).some((r) => r.status === "queued" || r.status === "running");
  const lastFailed = (runs ?? []).find((r) => r.status === "failed" || r.status === "refused");
  const editable = isEditable(draft.status);
  const hook = shown.selected_hook_index !== null ? shown.alternative_hooks[shown.selected_hook_index] : null;

  return (
    <>
      <AutoRefresh active={regenerating} />
      <PageHeader
        title={draft.concept?.title ?? "Draft"}
        description={`${draft.founder?.display_name} · ${monthLabel(draft.target_month.slice(0, 7))} · ${draft.concept?.core_argument ?? ""}`}
        actions={
          <Link
            href={`/admin/drafts?month=${draft.target_month.slice(0, 7)}`}
            className="text-sm text-muted hover:text-foreground"
          >
            ← All drafts
          </Link>
        }
      />
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <Badge tone={draft.status === "rejected" ? "danger" : "accent"}>{DRAFT_STATUS_LABELS[draft.status]}</Badge>
        {openBlocking ? (
          <Badge tone="danger">
            {openBlocking} blocking flag{openBlocking === 1 ? "" : "s"}
          </Badge>
        ) : null}
        <TransitionButtons draftId={draft.id} status={draft.status} options={nextStates(draft.status)} />
      </div>
      {regenerating ? (
        <p role="status" className="mb-4 text-sm text-muted">
          Writing a new version…
        </p>
      ) : lastFailed ? (
        <p role="alert" className="mb-4 text-sm text-danger">
          The last regeneration {lastFailed.status === "refused" ? "was refused" : "failed"}: {lastFailed.error_message}
        </p>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-[1fr_17rem]">
        <div className="space-y-6">
          <Card>
            <div className="mb-3 flex flex-wrap items-center gap-2 text-xs text-muted">
              <span className="font-semibold text-foreground">Version {shown.version_no}</span>
              {isCurrent ? <Badge tone="accent">current</Badge> : <Badge>read-only</Badge>}
              <span>
                {AUTHOR[shown.author_kind]}
                {shown.author?.email ? ` · ${shown.author.email}` : ""}
                {shown.run ? ` · ${shown.run.served_model ?? shown.run.model}` : ""}
                {shown.run?.actual_cost_usd !== null && shown.run?.actual_cost_usd !== undefined
                  ? ` · ${usd(Number(shown.run.actual_cost_usd))}`
                  : ""}
              </span>
              <span>· {shown.body.length.toLocaleString("en-US")} characters</span>
            </div>
            {hook ? (
              <p className="mb-2 text-xs text-muted">
                Chosen opening line: <span className="text-foreground">{hook}</span>
              </p>
            ) : null}
            <article aria-label="Post text" className="whitespace-pre-wrap text-[15px] leading-relaxed">
              {shown.body}
            </article>
            {shown.alternative_hooks.length ? (
              <div className="mt-4 border-t border-border pt-3">
                <h3 className="mb-1 text-xs font-semibold text-muted">Alternative opening lines</h3>
                <ol className="list-decimal space-y-1 pl-5 text-sm">
                  {shown.alternative_hooks.map((h, i) => (
                    <li key={i} className={cx(i === shown.selected_hook_index && "font-medium")}>
                      {h}
                    </li>
                  ))}
                </ol>
              </div>
            ) : null}
            {isCurrent && editable ? (
              <div className="mt-4 border-t border-border pt-4">
                <EditDraftForm
                  draftId={draft.id}
                  body={shown.body}
                  hooks={shown.alternative_hooks}
                  selectedHook={shown.selected_hook_index}
                />
              </div>
            ) : null}
          </Card>

          <Card>
            <h2 className="mb-3 text-sm font-semibold">Review flags</h2>
            {flags.length ? (
              <ul aria-label="Review flags" className="space-y-3 text-sm">
                {flags.map((f) => (
                  <li
                    key={f.id}
                    className={cx("rounded-md border border-border p-3", f.status !== "open" && "opacity-60")}
                  >
                    <div className="flex flex-wrap items-center gap-2 text-xs">
                      <Badge
                        tone={f.severity === "blocking" ? "danger" : f.severity === "warning" ? "accent" : "neutral"}
                      >
                        {f.severity}
                      </Badge>
                      <span className="text-muted">{f.kind.replaceAll("_", " ")}</span>
                      {f.status !== "open" ? <Badge>{f.status}</Badge> : null}
                    </div>
                    <p className="mt-1">{f.message}</p>
                    {f.span_start !== null && f.span_end !== null ? (
                      <p className="mt-1 text-xs text-muted">“{shown.body.slice(f.span_start, f.span_end)}”</p>
                    ) : null}
                    {f.resolution_note ? <p className="mt-1 text-xs text-muted">Reason: {f.resolution_note}</p> : null}
                    {isCurrent && f.status === "open" ? (
                      <FlagForm
                        draftId={draft.id}
                        flagId={f.id}
                        canResolve={f.source !== "placeholder" && f.kind !== "repetition"}
                        canOverride={f.kind === "repetition" || f.severity !== "blocking"}
                      />
                    ) : null}
                    {isCurrent && f.status === "open" && f.source === "placeholder" ? (
                      <p className="mt-1 text-xs text-muted">Clears when the placeholder is replaced in the text.</p>
                    ) : null}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted">No flags. That alone never approves a post.</p>
            )}
          </Card>

          <Card className="overflow-x-auto p-0">
            <h2 className="px-4 pt-4 text-sm font-semibold">Claims</h2>
            <table aria-label="Claims" className="mt-2 w-full text-left text-sm">
              <tbody>
                {shown.draft_claims.map((c) => (
                  <tr key={c.id} className="border-t border-border align-top">
                    <td className="px-4 py-2">{c.claim_text}</td>
                    <td className="px-4 py-2 text-xs text-muted">{KIND_LABEL[c.claim_kind]}</td>
                    <td className="px-4 py-2">
                      <Badge tone={SUPPORT_TONE[c.support_status]}>{c.support_status.replace("_", " ")}</Badge>
                      {c.approved_fact ? <span className="block text-xs text-muted">{c.approved_fact}</span> : null}
                    </td>
                  </tr>
                ))}
                {shown.draft_claims.length ? null : (
                  <tr>
                    <td className="px-4 py-3 text-muted">No claims recorded.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </Card>

          {compared ? (
            <Card>
              <h2 className="mb-2 text-sm font-semibold">
                Changes from v{compared.version_no} to v{shown.version_no}
              </h2>
              <p aria-label="Changes" className="whitespace-pre-wrap text-sm leading-relaxed">
                {diffWords(compared.body, shown.body).map((part, i) =>
                  part.kind === "same" ? (
                    <span key={i}>{part.text}</span>
                  ) : part.kind === "added" ? (
                    <ins key={i} className="bg-success/15 text-success no-underline">
                      {part.text}
                    </ins>
                  ) : (
                    <del key={i} className="bg-danger/10 text-danger">
                      {part.text}
                    </del>
                  ),
                )}
              </p>
            </Card>
          ) : null}

          <Card>
            <h2 className="mb-1 text-sm font-semibold">Rationale (internal)</h2>
            <p className="text-sm text-muted">{shown.rationale || "None recorded."}</p>
          </Card>
        </div>

        <div className="space-y-6">
          <Card className="h-fit">
            <h2 className="mb-3 text-sm font-semibold">Versions</h2>
            <ol className="space-y-2 text-sm">
              {versions.map((v) => (
                <li key={v.id}>
                  <Link
                    href={`/admin/drafts/${draft.id}?v=${v.version_no}`}
                    className={cx("block rounded px-2 py-1 hover:bg-background", v.id === shown.id && "bg-background")}
                  >
                    <span className="font-medium">v{v.version_no}</span>{" "}
                    {v.id === current.id ? <Badge tone="accent">current</Badge> : null}{" "}
                    <span className="text-xs text-muted">{AUTHOR[v.author_kind]}</span>
                    <span className="block text-xs text-muted">
                      {new Date(v.created_at).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" })}
                    </span>
                    {v.change_note ? <span className="block text-xs">{v.change_note}</span> : null}
                  </Link>
                </li>
              ))}
            </ol>
            {versions.length > 1 ? (
              <form className="mt-4 space-y-2 border-t border-border pt-3">
                <input type="hidden" name="v" value={shown.version_no} />
                <label className="block text-xs text-muted" htmlFor="compare">
                  Compare v{shown.version_no} with
                </label>
                <div className="flex gap-2">
                  <Select
                    id="compare"
                    name="compare"
                    defaultValue={String(compared?.version_no ?? "")}
                    className="h-8 text-xs"
                  >
                    {versions
                      .filter((v) => v.id !== shown.id)
                      .map((v) => (
                        <option key={v.id} value={v.version_no}>
                          v{v.version_no}
                        </option>
                      ))}
                  </Select>
                  <Button type="submit" variant="secondary" className="h-8 px-2 text-xs">
                    Compare
                  </Button>
                </div>
              </form>
            ) : null}
          </Card>
          {editable ? (
            <Card className="h-fit">
              <h2 className="mb-3 text-sm font-semibold">Regenerate</h2>
              <RegenerateDraftForm draftId={draft.id} nonce={crypto.randomUUID()} />
            </Card>
          ) : null}
        </div>
      </div>
    </>
  );
}
