import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { AutoRefresh } from "@/components/auto-refresh";
import { FOUNDER_NAV } from "@/components/founder-nav";
import { Badge, Card, PageHeader, cx } from "@/components/ui";
import { WordDiff } from "@/components/word-diff";
import { requireFounder } from "@/lib/auth/dal";
import { monthLabel } from "@/lib/domain/dates";
import { FOUNDER_STATUS_LABELS, approvalBlocker, isEditable } from "@/lib/domain/draft-states";
import { dateLabel } from "@/lib/domain/research";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import {
  ApproveForm,
  CommentForm,
  EditForm,
  RejectForm,
  RequestChangesForm,
  RevokeForm,
  RewriteForm,
} from "../review-forms";

export const metadata: Metadata = { title: "Review a draft" };
export const maxDuration = 300;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const AUTHOR = { ai: "AI", admin: "Admin", founder: "You" } as const;
const REWRITE_STATUS = { requested: "rewriting…", completed: "done", failed: "failed" } as const;

export default async function FounderDraftPage({ params, searchParams }: PageProps<"/drafts/[id]">) {
  const viewer = await requireFounder();
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  const query = await searchParams;

  // Every read goes through a function that returns only this founder's own
  // shared draft, and never the internal rationale or admin-only notes.
  const supabase = await createSupabaseServerClient();
  const [
    { data: drafts },
    { data: versions },
    { data: flags },
    { data: comments },
    { data: rewrites },
    { data: sources },
    { data: publishing },
    { data: founder },
  ] = await Promise.all([
    supabase.rpc("founder_drafts"),
    supabase.rpc("founder_draft_versions", { p_draft_id: id }),
    supabase.rpc("founder_draft_flags", { p_draft_id: id }),
    supabase.rpc("founder_comments", { p_draft_id: id }),
    supabase.rpc("founder_rewrite_requests", { p_draft_id: id }),
    supabase.rpc("founder_draft_sources", { p_draft_id: id }),
    supabase.rpc("founder_publishing"),
    // Row-level security returns only this founder's own record.
    supabase.from("founders").select("timezone").maybeSingle(),
  ]);
  const timeZone = founder?.timezone ?? "UTC";
  const goesOut = (publishing ?? []).find((p) => p.draft_id === id);
  const draft = drafts?.find((d) => d.id === id);
  if (!draft || !versions?.length) notFound();

  const current = versions.find((v) => v.is_current) ?? versions[0];
  const shownNo = typeof query.v === "string" ? Number(query.v) : current.version_no;
  const shown = versions.find((v) => v.version_no === shownNo) ?? current;
  const isCurrent = shown.id === current.id;
  const previous = versions.find((v) => v.version_no < shown.version_no);
  const openBlocking = (flags ?? []).filter((f) => f.severity === "blocking" && f.status === "open").length;
  const blocker = approvalBlocker({
    status: draft.status,
    placeholderCount: current.placeholder_count,
    openBlockingFlags: openBlocking,
  });
  const rewriting = (rewrites ?? []).some((r) => r.status === "requested");
  const editable = isEditable(draft.status, "founder");
  const hook = shown.selected_hook_index !== null ? shown.alternative_hooks[shown.selected_hook_index] : null;

  return (
    <AppShell nav={FOUNDER_NAV} email={viewer.email}>
      <AutoRefresh active={rewriting} />
      <PageHeader
        title={draft.title}
        description={monthLabel(draft.target_month.slice(0, 7))}
        actions={
          <Link href="/drafts" className="text-sm text-muted hover:text-foreground">
            ← All drafts
          </Link>
        }
      />
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <Badge tone={draft.approved ? "success" : "accent"}>
          {FOUNDER_STATUS_LABELS[draft.status] ?? draft.status}
        </Badge>
        {goesOut?.published_at && goesOut.linkedin_url ? (
          <a
            href={goesOut.linkedin_url}
            target="_blank"
            rel="noopener noreferrer nofollow"
            className="text-sm text-accent hover:underline"
          >
            Published{" "}
            {new Date(goesOut.published_at).toLocaleString("en-US", {
              dateStyle: "medium",
              timeStyle: "short",
              timeZone,
            })}
          </a>
        ) : goesOut?.scheduled_for ? (
          <span className="text-sm">
            Scheduled for{" "}
            {new Date(goesOut.scheduled_for).toLocaleString("en-US", {
              dateStyle: "medium",
              timeStyle: "short",
              timeZone,
            })}
          </span>
        ) : null}
        {rewriting ? (
          <span role="status" className="text-sm text-muted">
            Writing a new version…
          </span>
        ) : null}
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr_20rem]">
        <div className="space-y-6">
          <Card>
            <div className="mb-3 flex flex-wrap items-center gap-2 text-xs text-muted">
              <span className="font-semibold text-foreground">Version {shown.version_no}</span>
              {isCurrent ? <Badge tone="accent">current</Badge> : <Badge>earlier version</Badge>}
              <span>
                {AUTHOR[shown.author_kind]} ·{" "}
                {new Date(shown.created_at).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" })}
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
            {isCurrent && shown.alternative_hooks.length ? (
              <div className="mt-4 border-t border-border pt-3">
                <h3 className="mb-1 text-xs font-semibold text-muted">Other opening lines to consider</h3>
                <ol className="list-decimal space-y-1 pl-5 text-sm">
                  {shown.alternative_hooks.map((h, i) => (
                    <li key={i}>{h}</li>
                  ))}
                </ol>
              </div>
            ) : null}
            {isCurrent && editable ? (
              <div className="mt-4 border-t border-border pt-4">
                <EditForm draftId={id} body={shown.body} approved={draft.status === "approved"} />
              </div>
            ) : null}
          </Card>

          {isCurrent ? (
            <Card>
              <h2 className="mb-3 text-sm font-semibold">Things to check</h2>
              {flags?.length ? (
                <ul aria-label="Things to check" className="space-y-3 text-sm">
                  {flags.map((f) => (
                    <li
                      key={f.id}
                      className={cx("rounded-md border border-border p-3", f.status !== "open" && "opacity-60")}
                    >
                      <div className="flex flex-wrap items-center gap-2 text-xs">
                        <Badge tone={f.severity === "blocking" ? "danger" : "accent"}>
                          {f.severity === "blocking" ? "must fix" : f.severity}
                        </Badge>
                        {f.status !== "open" ? <Badge>{f.status}</Badge> : null}
                      </div>
                      <p className="mt-1">{f.message}</p>
                      {f.quote ? <p className="mt-1 text-xs text-muted">“{f.quote}”</p> : null}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-muted">Nothing flagged. Read it through before you approve.</p>
              )}
            </Card>
          ) : null}

          {isCurrent && sources?.length ? (
            <Card>
              <h2 className="mb-3 text-sm font-semibold">Sources</h2>
              <ul aria-label="Sources" className="space-y-3 text-sm">
                {sources.map((s, i) => (
                  <li key={i}>
                    <p>“{s.claim_text}”</p>
                    <p className="mt-1 text-xs text-muted">
                      {s.source_url ? (
                        <>
                          <a
                            href={s.source_url}
                            target="_blank"
                            rel="noopener noreferrer nofollow"
                            className="text-accent hover:underline"
                          >
                            {s.source_title || s.publisher}
                          </a>{" "}
                          · {s.publisher} · {dateLabel(s.published_at, s.published_at_precision)}
                          {s.finding_quote ? <span className="block">Source says: “{s.finding_quote}”</span> : null}
                        </>
                      ) : s.approved_fact ? (
                        <>From this month&apos;s brief: {s.approved_fact}</>
                      ) : (
                        <span className="text-danger">No source yet: see Things to check.</span>
                      )}
                    </p>
                  </li>
                ))}
              </ul>
            </Card>
          ) : null}

          {previous ? (
            <Card>
              <h2 className="mb-2 text-sm font-semibold">
                Changes from v{previous.version_no} to v{shown.version_no}
              </h2>
              <WordDiff before={previous.body} after={shown.body} />
            </Card>
          ) : null}

          <Card>
            <h2 className="mb-3 text-sm font-semibold">Comments</h2>
            {comments?.length ? (
              <ul aria-label="Comments" className="mb-4 space-y-3 text-sm">
                {comments.map((c) => (
                  <li key={c.id} className={cx("rounded-md border border-border p-3", c.resolved && "opacity-60")}>
                    <p className="text-xs text-muted">
                      {c.author_role === "admin" ? "Admin" : "You"} · on v{c.version_no}
                      {c.resolved ? " · resolved" : ""}
                    </p>
                    {c.quote ? <p className="mt-1 text-xs text-muted">“{c.quote}”</p> : null}
                    <p className="mt-1 whitespace-pre-wrap">{c.body}</p>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mb-4 text-sm text-muted">No comments yet.</p>
            )}
            <CommentForm draftId={id} />
          </Card>
        </div>

        <div className="space-y-6">
          {draft.status === "founder_review" ? (
            <Card className="h-fit">
              <h2 className="mb-3 text-sm font-semibold">Approve</h2>
              <ApproveForm draftId={id} versionId={current.id} versionNo={current.version_no} blocker={blocker} />
            </Card>
          ) : null}
          {draft.status === "approved" || draft.status === "scheduled" ? (
            <Card className="h-fit">
              <h2 className="mb-1 text-sm font-semibold">You approved version {current.version_no}</h2>
              <p className="mb-3 text-xs text-muted">
                {draft.status === "scheduled" ? "It is scheduled. " : "The admin will schedule it. "}Editing the text,
                or a rewrite, withdraws your approval (and unschedules it) until you approve again.
              </p>
              <RevokeForm draftId={id} />
            </Card>
          ) : null}
          {draft.status === "changes_requested" ? (
            <Card className="h-fit">
              <p className="text-sm">
                You asked for changes. The admin will share a new version, or edit it yourself and it comes back here
                for approval.
              </p>
            </Card>
          ) : null}
          {draft.status === "founder_review" ? (
            <Card className="h-fit">
              <h2 className="mb-3 text-sm font-semibold">Send it back</h2>
              <RequestChangesForm draftId={id} />
            </Card>
          ) : null}
          {editable ? (
            <Card className="h-fit">
              <h2 className="mb-3 text-sm font-semibold">Rewrite</h2>
              <RewriteForm draftId={id} nonce={crypto.randomUUID()} />
              {rewrites?.length ? (
                <ul aria-label="Rewrite requests" className="mt-3 space-y-1 text-xs text-muted">
                  {rewrites.map((r) => (
                    <li key={r.id}>
                      “{r.instructions.slice(0, 80)}” · {REWRITE_STATUS[r.status]}
                    </li>
                  ))}
                </ul>
              ) : null}
            </Card>
          ) : null}
          <Card className="h-fit">
            <h2 className="mb-3 text-sm font-semibold">Versions</h2>
            <ol className="space-y-2 text-sm">
              {versions.map((v) => (
                <li key={v.id}>
                  <Link
                    href={`/drafts/${id}?v=${v.version_no}`}
                    className={cx("block rounded px-2 py-1 hover:bg-background", v.id === shown.id && "bg-background")}
                  >
                    <span className="font-medium">v{v.version_no}</span>{" "}
                    {v.is_current ? <Badge tone="accent">current</Badge> : null}{" "}
                    <span className="text-xs text-muted">{AUTHOR[v.author_kind]}</span>
                    {v.change_note ? <span className="block text-xs">{v.change_note}</span> : null}
                  </Link>
                </li>
              ))}
            </ol>
          </Card>
          {draft.status === "founder_review" || draft.status === "changes_requested" ? (
            <Card className="h-fit">
              <RejectForm draftId={id} />
            </Card>
          ) : null}
        </div>
      </div>
    </AppShell>
  );
}
