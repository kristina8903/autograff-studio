"use client";

import { useActionState, useState } from "react";
import { Alert, Button, Field, Input, Select, Textarea } from "@/components/ui";
import {
  regenerateDraftAction,
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
      <Field label="What should the new version do differently? (optional)">
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
        <Field label="What changed (optional)">
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
          {status === "archived" ? "Restore to review" : TRANSITION_LABELS[to]}
        </Button>
      ))}
      {state.error ? <span className="text-xs text-danger">{state.error}</span> : null}
    </form>
  );
}
