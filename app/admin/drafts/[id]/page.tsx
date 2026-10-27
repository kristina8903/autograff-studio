import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AutoRefresh } from "@/components/auto-refresh";
import { Badge, Button, Card, PageHeader, Select, cx } from "@/components/ui";
import { WordDiff } from "@/components/word-diff";
import { requireAdmin } from "@/lib/auth/dal";
import {
  addMonths,
  lastDayOfMonth,
  localDateTime,
  localToday,
  monthLabel,
  monthOf,
  shortDateLabel,
} from "@/lib/domain/dates";
import { publishableText } from "@/lib/domain/drafts";
import { METRIC_KEYS, METRIC_LABELS } from "@/lib/domain/reports";
import { DRAFT_STATUS_LABELS, isEditable, nextStates } from "@/lib/domain/draft-states";
import { usd } from "@/lib/domain/pricing";
import { dateLabel } from "@/lib/domain/research";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import {
  AdminCommentForm,
  EditDraftForm,
  FlagForm,
  RegenerateDraftForm,
  ResolveCommentButton,
  ShareForm,
  TransitionButtons,
} from "../draft-forms";
import {
  CopyApprovedButton,
  MetricsForm,
  RecordPublicationForm,
  ScheduleForm,
  UnscheduleButton,
} from "../../publishing-forms";

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
  const [
    { data: draft },
    { data: versions },
    { data: runs },
    { data: approvals },
    { data: comments },
    { data: rewrites },
  ] = await Promise.all([
    supabase
      .from("drafts")
      .select("*, founder:founders(display_name, role_title, timezone), concept:concepts(id, title, core_argument)")
      .eq("id", id)
      .maybeSingle(),
    supabase
      .from("draft_versions")
      .select(
        "*, author:profiles(email), run:generation_runs(model, served_model, actual_cost_usd), draft_claims(*, finding:research_findings(claim_text, verification_status, source:research_sources(title, url, publisher, status, published_at, published_at_precision))), review_flags(*)",
      )
      .eq("draft_id", id)
      .order("version_no", { ascending: false }),
    supabase
      .from("generation_runs")
      .select("id, status, error_message, created_at")
      .in("kind", ["draft_regen", "rewrite"])
      .contains("params", { draft_id: id })
      .order("created_at", { ascending: false })
      .limit(5),
    supabase
      .from("approvals")
      .select("*, approver:profiles(email), version:draft_versions!approvals_draft_version_id_fkey(version_no)")
      .eq("draft_id", id)
      .order("created_at", { ascending: false }),
    supabase
      .from("comments")
      .select("*, author:profiles!comments_author_user_id_fkey(email), version:draft_versions(version_no)")
      .eq("draft_id", id)
      .order("created_at"),
    supabase
      .from("rewrite_requests")
      .select("id, instructions, status, created_at, version:draft_versions(version_no)")
      .eq("draft_id", id)
      .order("created_at", { ascending: false }),
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
  const regenerable = draft.status === "drafting" || draft.status === "admin_review";
  const shareable = draft.status === "admin_review" || draft.status === "changes_requested";
  const hook = shown.selected_hook_index !== null ? shown.alternative_hooks[shown.selected_hook_index] : null;

  // Publishing (Phase 9): only an approved, scheduled or published draft.
  const publishing = ["approved", "scheduled", "published"].includes(draft.status);
  const timeZone = draft.founder?.timezone ?? "UTC";
  const [{ data: publication }, { data: slots }] = publishing
    ? await Promise.all([
        supabase
          .from("publications")
          .select("*, performance_snapshots(captured_at, metrics)")
          .eq("draft_id", draft.id)
          .order("captured_at", { referencedTable: "performance_snapshots", ascending: false })
          .maybeSingle(),
        supabase
          .from("calendar_slots")
          .select("id, slot_date, kind, status, draft_id")
          .eq("founder_id", draft.founder_id)
          .gte("slot_date", localToday(timeZone))
          .lte("slot_date", lastDayOfMonth(addMonths(monthOf(draft.target_month), 1)))
          .or(`status.eq.open,draft_id.eq.${draft.id}`)
          .order("slot_date"),
      ])
    : [{ data: null }, { data: [] }];
  const currentSlot = (slots ?? []).find((s) => s.draft_id === draft.id) ?? null;
  const toPost = publishableText({
    body: current.body,
    alternativeHooks: current.alternative_hooks,
    selectedHookIndex: current.selected_hook_index,
  });
  const defaultScheduleTime = draft.scheduled_for
    ? localDateTime(timeZone, new Date(draft.scheduled_for))
    : `${currentSlot?.slot_date ?? draft.proposed_date ?? localToday(timeZone)}T09:00`;
  const latestMetrics = publication?.performance_snapshots[0] ?? null;

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
        <TransitionButtons
          draftId={draft.id}
          status={draft.status}
          // Sharing, scheduling and publishing have their own forms.
          options={nextStates(draft.status).filter((to) =>
            ["drafting", "admin_review", "rejected", "archived"].includes(to),
          )}
        />
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
          {publishing ? (
            <Card>
              <h2 className="mb-3 text-sm font-semibold">Publishing</h2>
              {publication ? (
                <div className="space-y-3 text-sm" aria-label="Publication">
                  <p>
                    Published{" "}
                    {new Date(publication.published_at).toLocaleString("en-US", {
                      dateStyle: "medium",
                      timeStyle: "short",
                      timeZone,
                    })}{" "}
                    ·{" "}
                    <a
                      href={publication.linkedin_url}
                      target="_blank"
                      rel="noopener noreferrer nofollow"
                      className="text-accent hover:underline"
                    >
                      View on LinkedIn
                    </a>
                  </p>
                  {publication.differs_from_approved && publication.approved_text ? (
                    <div>
                      <Badge tone="danger">posted text differs from the approved version</Badge>
                      <div className="mt-2 rounded-md border border-border p-3">
                        <WordDiff before={publication.approved_text} after={publication.published_text} />
                      </div>
                    </div>
                  ) : (
                    <p className="text-muted">Posted exactly as approved.</p>
                  )}
                  <div className="border-t border-border pt-3">
                    <h3 className="mb-2 text-xs font-semibold text-muted">Metrics</h3>
                    {latestMetrics ? (
                      <p className="mb-2 text-xs">
                        As of {new Date(latestMetrics.captured_at).toLocaleDateString("en-US", { dateStyle: "medium" })}
                        :{" "}
                        {METRIC_KEYS.filter(
                          (k) => typeof (latestMetrics.metrics as Record<string, unknown>)[k] === "number",
                        )
                          .map(
                            (k) =>
                              `${METRIC_LABELS[k]} ${(latestMetrics.metrics as Record<string, number>)[k].toLocaleString("en-US")}`,
                          )
                          .join(" · ")}
                      </p>
                    ) : null}
                    <MetricsForm publicationId={publication.id} draftId={draft.id} />
                  </div>
                </div>
              ) : (
                <div className="space-y-5">
                  <div>
                    <h3 className="mb-1 text-xs font-semibold text-muted">Text to post</h3>
                    <pre
                      aria-label="Text to post"
                      className="mb-2 whitespace-pre-wrap rounded-md border border-border bg-background p-3 font-sans text-sm"
                    >
                      {toPost}
                    </pre>
                    <CopyApprovedButton draftId={draft.id} />
                  </div>
                  <div className="grid gap-6 border-t border-border pt-4 sm:grid-cols-2">
                    <div>
                      <h3 className="mb-2 text-xs font-semibold text-muted">
                        {draft.status === "scheduled" && draft.scheduled_for
                          ? `Scheduled for ${new Date(draft.scheduled_for).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short", timeZone })}`
                          : "Schedule"}
                      </h3>
                      <ScheduleForm
                        draftId={draft.id}
                        defaultTime={defaultScheduleTime}
                        timeZone={timeZone}
                        scheduled={draft.status === "scheduled"}
                        currentSlotId={currentSlot?.id ?? null}
                        slots={(slots ?? []).map((s) => ({
                          id: s.id,
                          label: `${shortDateLabel(s.slot_date)}${s.draft_id === draft.id ? " (this draft)" : ""}`,
                        }))}
                      />
                      {draft.status === "scheduled" ? (
                        <div className="mt-3">
                          <UnscheduleButton draftId={draft.id} />
                        </div>
                      ) : null}
                    </div>
                    <div>
                      <h3 className="mb-2 text-xs font-semibold text-muted">Record the publication</h3>
                      <RecordPublicationForm draftId={draft.id} defaultTime={localDateTime(timeZone, new Date())} />
                    </div>
                  </div>
                </div>
              )}
            </Card>
          ) : null}
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
                      {f.visible_to_founder ? <Badge>shown to founder</Badge> : null}
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
                      {c.approved_fact ? (
                        <span className="block text-xs text-muted">Brief: {c.approved_fact}</span>
                      ) : null}
                      {c.finding?.source ? (
                        <span className="block text-xs text-muted">
                          <a
                            href={c.finding.source.url}
                            target="_blank"
                            rel="noopener noreferrer nofollow"
                            className="text-accent hover:underline"
                          >
                            {c.finding.source.title || c.finding.source.publisher}
                          </a>{" "}
                          · {c.finding.source.publisher} ·{" "}
                          {dateLabel(c.finding.source.published_at, c.finding.source.published_at_precision)}
                          {c.finding.verification_status !== "human_verified" ||
                          c.finding.source.status !== "accepted" ? (
                            <span className="block text-danger">
                              The finding is now {c.finding.verification_status.replace("_", " ")}
                              {c.finding.source.status !== "accepted"
                                ? ` and its source ${c.finding.source.status}`
                                : ""}
                              .
                            </span>
                          ) : null}
                        </span>
                      ) : null}
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
              <WordDiff before={compared.body} after={shown.body} />
            </Card>
          ) : null}

          <Card>
            <h2 className="mb-1 text-sm font-semibold">Rationale (internal)</h2>
            <p className="text-sm text-muted">{shown.rationale || "None recorded."}</p>
          </Card>

          <Card>
            <h2 className="mb-3 text-sm font-semibold">Comments</h2>
            {comments?.length ? (
              <ul aria-label="Comments" className="mb-4 space-y-3 text-sm">
                {comments.map((c) => (
                  <li key={c.id} className={cx("rounded-md border border-border p-3", c.resolved_at && "opacity-60")}>
                    <div className="flex flex-wrap items-center gap-2 text-xs text-muted">
                      <span>
                        {c.author_role === "admin" ? "Admin" : "Founder"} · {c.author?.email ?? "removed user"} · on v
                        {c.version?.version_no}
                      </span>
                      <Badge tone={c.visibility === "shared" ? "accent" : "neutral"}>
                        {c.visibility === "shared" ? "shared" : "internal"}
                      </Badge>
                      {c.resolved_at ? (
                        <Badge>resolved</Badge>
                      ) : (
                        <ResolveCommentButton draftId={draft.id} commentId={c.id} />
                      )}
                    </div>
                    {c.anchor && typeof c.anchor === "object" && "quote" in c.anchor ? (
                      <p className="mt-1 text-xs text-muted">“{String(c.anchor.quote)}”</p>
                    ) : null}
                    <p className="mt-1 whitespace-pre-wrap">{c.body}</p>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mb-4 text-sm text-muted">No comments yet.</p>
            )}
            <AdminCommentForm draftId={draft.id} shared={draft.shared_with_founder_at !== null} />
          </Card>
        </div>

        <div className="space-y-6">
          {shareable ? (
            <Card className="h-fit">
              <h2 className="mb-3 text-sm font-semibold">Founder review</h2>
              <ShareForm
                draftId={draft.id}
                again={draft.shared_with_founder_at !== null}
                flags={current.review_flags
                  // Repetition flags quote other drafts, so they are never shared.
                  .filter((f) => (f.status === "open" || f.visible_to_founder) && f.source !== "repetition")
                  .map((f) => ({
                    id: f.id,
                    label: `${f.severity}: ${f.message}`,
                    blocking: f.severity === "blocking" && f.status === "open",
                  }))}
              />
            </Card>
          ) : null}
          <Card className="h-fit">
            <h2 className="mb-3 text-sm font-semibold">Approval</h2>
            {approvals?.length ? (
              <ul aria-label="Approvals" className="space-y-2 text-xs">
                {approvals.map((a) => (
                  <li
                    key={a.id}
                    className={cx("rounded-md border border-border p-2", a.invalidated_at && "opacity-70")}
                  >
                    <span className="font-medium text-foreground">
                      {a.decision === "approved" ? "Approved" : "Rejected"} v{a.version?.version_no}
                    </span>{" "}
                    {a.decision === "approved" && !a.invalidated_at ? <Badge tone="success">valid</Badge> : null}
                    <span className="block text-muted">
                      {a.approver?.email} ·{" "}
                      {new Date(a.created_at).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" })}
                    </span>
                    <span className="block font-mono text-muted">
                      hash {a.body_hash.replace(/^\\x/, "").slice(0, 12)}
                    </span>
                    {a.note ? <span className="block">“{a.note}”</span> : null}
                    {a.invalidated_at ? (
                      <span className="block text-danger">
                        Withdrawn: {a.invalidated_reason}
                        {a.invalidated_at
                          ? ` · ${new Date(a.invalidated_at).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" })}`
                          : ""}
                      </span>
                    ) : null}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted">
                {draft.shared_with_founder_at ? "Not approved yet." : "Not shared with the founder yet."}
              </p>
            )}
          </Card>
          {rewrites?.length ? (
            <Card className="h-fit">
              <h2 className="mb-3 text-sm font-semibold">Founder&apos;s rewrite requests</h2>
              <ul aria-label="Rewrite requests" className="space-y-2 text-xs">
                {rewrites.map((r) => (
                  <li key={r.id}>
                    “{r.instructions}” · {r.status}
                    {r.version ? ` · v${r.version.version_no}` : ""}
                  </li>
                ))}
              </ul>
            </Card>
          ) : null}
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
          {regenerable ? (
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
