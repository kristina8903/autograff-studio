"use client";

import { useActionState, useState } from "react";
import { Alert, Button, Field, Input, Textarea } from "@/components/ui";
import {
  addCommentAction,
  approveDraftAction,
  founderSaveVersionAction,
  rejectDraftAction,
  requestChangesAction,
  requestRewriteAction,
  revokeApprovalAction,
  type ActionState,
} from "./actions";

function Result({ state }: { state: ActionState }) {
  if (state.error) return <Alert tone="error">{state.error}</Alert>;
  if (state.message) return <Alert tone="success">{state.message}</Alert>;
  return null;
}

/** Approves the exact version on screen; the database refuses it if the draft changed meanwhile. */
export function ApproveForm({
  draftId,
  versionId,
  versionNo,
  blocker,
}: {
  draftId: string;
  versionId: string;
  versionNo: number;
  blocker: string | null;
}) {
  const [state, action, pending] = useActionState<ActionState, FormData>(approveDraftAction, {});
  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="draft_id" value={draftId} />
      <input type="hidden" name="version_id" value={versionId} />
      <Field label="Note (optional)">
        <Input name="note" maxLength={1000} disabled={blocker !== null} />
      </Field>
      <Button type="submit" disabled={pending || blocker !== null} aria-describedby="approve-help">
        {pending ? "Approving…" : `Approve version ${versionNo}`}
      </Button>
      <p id="approve-help" className="text-xs text-muted">
        {blocker ?? "You approve exactly this text. Any later change to it needs your approval again."}
      </p>
      <Result state={state} />
    </form>
  );
}

export function RevokeForm({ draftId }: { draftId: string }) {
  const [state, action, pending] = useActionState<ActionState, FormData>(revokeApprovalAction, {});
  return (
    <form action={action} className="space-y-2">
      <input type="hidden" name="draft_id" value={draftId} />
      <Field label="Why (optional)">
        <Input name="reason" maxLength={200} />
      </Field>
      <Button type="submit" variant="secondary" disabled={pending}>
        Withdraw my approval
      </Button>
      <Result state={state} />
    </form>
  );
}

export function EditForm({ draftId, body, approved }: { draftId: string; body: string; approved: boolean }) {
  const [state, action, pending] = useActionState<ActionState, FormData>(founderSaveVersionAction, {});
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
      <Field
        label="Post text"
        hint={`Replace any [FOUNDER TO SUPPLY: …] with your own words. LinkedIn allows 3,000 characters.${approved ? " Changing the text withdraws your approval until you approve again." : ""}`}
      >
        <Textarea name="body" defaultValue={body} rows={14} required maxLength={6000} />
      </Field>
      <Field label="What changed (optional)">
        <Input name="change_note" maxLength={500} />
      </Field>
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

export function RequestChangesForm({ draftId }: { draftId: string }) {
  const [state, action, pending] = useActionState<ActionState, FormData>(requestChangesAction, {});
  return (
    <form action={action} className="space-y-2">
      <input type="hidden" name="draft_id" value={draftId} />
      <Field label="What should change?">
        <Textarea name="comment" rows={3} maxLength={2000} required />
      </Field>
      <Button type="submit" variant="secondary" disabled={pending}>
        Request changes
      </Button>
      <Result state={state} />
    </form>
  );
}

export function RejectForm({ draftId }: { draftId: string }) {
  const [state, action, pending] = useActionState<ActionState, FormData>(rejectDraftAction, {});
  const [confirming, setConfirming] = useState(false);
  if (!confirming)
    return (
      <Button type="button" variant="danger" onClick={() => setConfirming(true)}>
        Reject this draft
      </Button>
    );
  return (
    <form action={action} className="space-y-2">
      <input type="hidden" name="draft_id" value={draftId} />
      <Field label="Why (optional)">
        <Input name="note" maxLength={1000} />
      </Field>
      <div className="flex gap-2">
        <Button type="submit" variant="danger" disabled={pending}>
          Confirm rejection
        </Button>
        <Button type="button" variant="secondary" onClick={() => setConfirming(false)}>
          Cancel
        </Button>
      </div>
      <Result state={state} />
    </form>
  );
}

export function RewriteForm({ draftId, nonce }: { draftId: string; nonce: string }) {
  const [state, action, pending] = useActionState<ActionState, FormData>(requestRewriteAction, {});
  return (
    <form action={action} className="space-y-2">
      <input type="hidden" name="draft_id" value={draftId} />
      <input type="hidden" name="nonce" value={nonce} />
      <Field label="What should the rewrite do differently?" hint="The current text is kept as an earlier version.">
        <Textarea
          name="instructions"
          rows={3}
          maxLength={1000}
          required
          placeholder="e.g. Shorter, and open with the van story"
        />
      </Field>
      <Button type="submit" variant="secondary" disabled={pending}>
        {pending ? "Requesting…" : "Ask for a rewrite"}
      </Button>
      <Result state={state} />
    </form>
  );
}

export function CommentForm({ draftId }: { draftId: string }) {
  const [state, action, pending] = useActionState<ActionState, FormData>(addCommentAction, {});
  return (
    <form action={action} className="space-y-2">
      <input type="hidden" name="draft_id" value={draftId} />
      <Field label="Comment">
        <Textarea name="body" rows={2} maxLength={2000} required />
      </Field>
      <Field label="About this text (optional)" hint="Paste the words your comment is about.">
        <Input name="quote" maxLength={500} />
      </Field>
      <Button type="submit" variant="secondary" disabled={pending}>
        Add comment
      </Button>
      <Result state={state} />
    </form>
  );
}
