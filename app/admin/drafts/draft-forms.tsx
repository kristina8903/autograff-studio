"use client";

import { useActionState, useState } from "react";
import { Alert, Button, Field, Input, Select, Textarea } from "@/components/ui";
import {
  addAdminCommentAction,
  regenerateDraftAction,
  resolveCommentAction,
  shareDraftAction,
  requestDraftAction,
  resolveFlagAction,
  saveDraftVersionAction,
  transitionDraftAction,
  type ActionState,
} from "../draft-actions";

function Result({ state }: { state: ActionState }) {
  if (state.error) return <Alert tone="error">{state.error}</Alert>;
  if (state.message) return <Alert tone="success">{state.message}</Alert>;
  return null;
}

export function WriteDraftForm({ conceptId, nonce, label }: { conceptId: string; nonce: string; label: string }) {
  const [state, action, pending] = useActionState<ActionState, FormData>(requestDraftAction, {});
  return (
    <form action={action} className="flex flex-wrap items-center gap-2">
      <input type="hidden" name="concept_id" value={conceptId} />
      <input type="hidden" name="nonce" value={nonce} />
      <Button type="submit" disabled={pending} className="h-8 px-2 text-xs">
        {pending ? "Requesting…" : label}
      </Button>
      {state.error || state.message ? (
        <div className="w-full">
          <Result state={state} />
        </div>
      ) : null}
    </form>
  );
}

export function RegenerateDraftForm({ draftId, nonce }: { draftId: string; nonce: string }) {
  const [state, action, pending] = useActionState<ActionState, FormData>(regenerateDraftAction, {});
  return (
    <form action={action} className="space-y-2">
      <input type="hidden" name="draft_id" value={draftId} />
      <input type="hidden" name="nonce" value={nonce} />
      <Field
        label="What should the new version do differently? (optional)"
        hint="Kept as the version's note, which the founder sees once the draft is shared."
      >
        <Input name="guidance" maxLength={500} placeholder="e.g. Shorter, and open with the cost" />
      </Field>
      <Button type="submit" variant="secondary" disabled={pending}>
        {pending ? "Requesting…" : "Regenerate as a new version"}
      </Button>
      <Result state={state} />
    </form>
  );
}

export function EditDraftForm({
  draftId,
  body,
  hooks,
  selectedHook,
}: {
  draftId: string;
  body: string;
  hooks: string[];
  selectedHook: number | null;
}) {
  const [state, action, pending] = useActionState<ActionState, FormData>(saveDraftVersionAction, {});
  const [open, setOpen] = useState(false);
  if (!open)
    return (
      <Button type="button" variant="secondary" onClick={() => setOpen(true)}>
        Edit text
      </Button>
    );
  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="draft_id" value={draftId} />
      <Field label="Post text" hint={`${body.length.toLocaleString("en-US")} characters; LinkedIn allows 3,000.`}>
        <Textarea name="body" defaultValue={body} rows={14} required maxLength={6000} />
      </Field>
      <Field label="Alternative opening lines" hint="One per line.">
        <Textarea name="alternative_hooks" defaultValue={hooks.join("\n")} rows={3} />
      </Field>
      <div className="flex flex-wrap items-end gap-3">
        <Field label="Chosen opening line">
          <Select
            name="selected_hook"
            defaultValue={selectedHook === null ? "" : String(selectedHook)}
            className="w-64"
          >
            <option value="">The post&apos;s own first line</option>
            {hooks.map((hook, i) => (
              <option key={i} value={i}>
                {hook.slice(0, 60)}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="What changed (optional)" hint="The founder sees this note.">
          <Input name="change_note" maxLength={500} className="w-64" />
        </Field>
      </div>
      <div className="flex gap-2">
        <Button type="submit" disabled={pending}>
          {pending ? "Saving…" : "Save as a new version"}
        </Button>
        <Button type="button" variant="secondary" onClick={() => setOpen(false)}>
          Close
        </Button>
      </div>
      <Result state={state} />
    </form>
  );
}

export function FlagForm({
  draftId,
  flagId,
  canResolve,
  canOverride,
}: {
  draftId: string;
  flagId: string;
  canResolve: boolean;
  canOverride: boolean;
}) {
  const [state, action, pending] = useActionState<ActionState, FormData>(resolveFlagAction, {});
  if (!canResolve && !canOverride) return null;
  return (
    <form action={action} className="mt-2 flex flex-wrap items-center gap-2">
      <input type="hidden" name="draft_id" value={draftId} />
      <input type="hidden" name="flag_id" value={flagId} />
      <Input name="note" maxLength={500} placeholder="Reason" aria-label="Reason" className="h-8 w-64 text-xs" />
      {canResolve ? (
        <Button name="flag_action" value="resolve" variant="secondary" disabled={pending} className="h-8 px-2 text-xs">
          Resolve
        </Button>
      ) : null}
      {canOverride ? (
        <Button name="flag_action" value="override" variant="secondary" disabled={pending} className="h-8 px-2 text-xs">
          Override
        </Button>
      ) : null}
      {state.error ? <span className="w-full text-xs text-danger">{state.error}</span> : null}
    </form>
  );
}

const TRANSITION_LABELS: Record<string, string> = {
  drafting: "Back to drafting",
  admin_review: "Ready for review",
  rejected: "Reject",
  archived: "Archive",
};

// From a shared or approved draft, "admin review" takes it back from the founder.
const TAKE_BACK: Record<string, string> = {
  founder_review: "Take back for revision",
  changes_requested: "Take back for revision",
  approved: "Withdraw approval and revise",
  archived: "Restore to review",
};

export function TransitionButtons({
  draftId,
  status,
  options,
}: {
  draftId: string;
  status: string;
  options: string[];
}) {
  const [state, action, pending] = useActionState<ActionState, FormData>(transitionDraftAction, {});
  if (!options.length) return null;
  return (
    <form action={action} className="flex flex-wrap items-center gap-2">
      <input type="hidden" name="draft_id" value={draftId} />
      {options.map((to) => (
        <Button
          key={to}
          name="to"
          value={to}
          variant={to === "rejected" ? "danger" : "secondary"}
          disabled={pending}
          className="h-8 px-2 text-xs"
        >
          {to === "admin_review" && TAKE_BACK[status] ? TAKE_BACK[status] : TRANSITION_LABELS[to]}
        </Button>
      ))}
      {state.error ? <span className="text-xs text-danger">{state.error}</span> : null}
    </form>
  );
}

export function ShareForm({
  draftId,
  flags,
  again,
}: {
  draftId: string;
  flags: { id: string; label: string; blocking: boolean }[];
  again: boolean;
}) {
  const [state, action, pending] = useActionState<ActionState, FormData>(shareDraftAction, {});
  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="draft_id" value={draftId} />
      {flags.length ? (
        <fieldset className="space-y-1 text-sm">
          <legend className="mb-1 text-xs text-muted">
            Flags the founder sees. Open blocking flags are always shown, so they know why they can&apos;t approve.
          </legend>
          {flags.map((f) => (
            <label key={f.id} className="flex items-start gap-2">
              <input
                type="checkbox"
                name="visible_flag"
                value={f.id}
                defaultChecked={f.blocking}
                disabled={f.blocking}
                className="mt-1"
              />
              <span>{f.label}</span>
            </label>
          ))}
        </fieldset>
      ) : null}
      <Button type="submit" disabled={pending}>
        {pending ? "Sharing…" : again ? "Share the new version with the founder" : "Share with the founder"}
      </Button>
      <Result state={state} />
    </form>
  );
}

export function AdminCommentForm({ draftId, shared }: { draftId: string; shared: boolean }) {
  const [state, action, pending] = useActionState<ActionState, FormData>(addAdminCommentAction, {});
  return (
    <form action={action} className="space-y-2">
      <input type="hidden" name="draft_id" value={draftId} />
      <Field label="Comment">
        <Textarea name="body" rows={2} maxLength={2000} required />
      </Field>
      <Field label="About this text (optional)">
        <Input name="quote" maxLength={500} />
      </Field>
      <div className="flex flex-wrap items-center gap-2">
        <Select
          name="visibility"
          defaultValue={shared ? "shared" : "admin_internal"}
          aria-label="Who sees it"
          className="w-56"
        >
          <option value="admin_internal">Internal (admin only)</option>
          <option value="shared">Shared with the founder</option>
        </Select>
        <Button type="submit" variant="secondary" disabled={pending}>
          Add comment
        </Button>
      </div>
      <Result state={state} />
    </form>
  );
}

export function ResolveCommentButton({ draftId, commentId }: { draftId: string; commentId: string }) {
  const [, action, pending] = useActionState<ActionState, FormData>(resolveCommentAction, {});
  return (
    <form action={action}>
      <input type="hidden" name="draft_id" value={draftId} />
      <input type="hidden" name="comment_id" value={commentId} />
      <Button variant="secondary" disabled={pending} className="h-7 px-2 text-xs">
        Resolve
      </Button>
    </form>
  );
}
