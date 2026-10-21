"use client";

import { useActionState, useState } from "react";
import { Alert, Button, Field, Input, Select, Textarea } from "@/components/ui";
import { FEEDBACK_KIND_LABELS } from "@/lib/domain/feedback";
import { POST_FORMATS } from "@/lib/domain/formats";
import { addFeedbackAction, reviewFeedbackAction, type ActionState } from "../voice-actions";

export function AddFeedbackForm({ founders }: { founders: { id: string; label: string }[] }) {
  const [state, action, pending] = useActionState<ActionState, FormData>(addFeedbackAction, {});
  const [kind, setKind] = useState("stable_preference");
  return (
    <form action={action} className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Founder">
          <Select name="founder_id" required>
            {founders.map((f) => (
              <option key={f.id} value={f.id}>
                {f.label}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Kind">
          <Select name="kind" value={kind} onChange={(e) => setKind(e.target.value)}>
            {Object.entries(FEEDBACK_KIND_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </Select>
        </Field>
        {kind === "format_preference" ? (
          <Field label="For format">
            <Select name="format" required>
              {POST_FORMATS.map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </Select>
          </Field>
        ) : null}
      </div>
      <Field label="Feedback" hint="e.g. Never open with a question.">
        <Textarea name="statement" rows={2} required maxLength={1000} />
      </Field>
      <Button type="submit" disabled={pending}>
        {pending ? "Adding…" : "Add feedback"}
      </Button>
      {state.error ? <Alert tone="error">{state.error}</Alert> : null}
      {state.message ? <Alert tone="success">{state.message}</Alert> : null}
    </form>
  );
}

export function ReviewFeedbackForm({ signalId, canAccept }: { signalId: string; canAccept: boolean }) {
  const [state, action, pending] = useActionState<ActionState, FormData>(reviewFeedbackAction, {});
  return (
    <form action={action} className="flex flex-wrap items-center justify-end gap-2">
      <input type="hidden" name="signal_id" value={signalId} />
      <Input name="note" placeholder="Note (optional)" maxLength={500} aria-label="Note" className="h-8 w-44 text-xs" />
      {canAccept ? (
        <Button name="decision" value="accept" variant="secondary" disabled={pending} className="h-8 px-2 text-xs">
          Accept
        </Button>
      ) : null}
      <Button name="decision" value="reject" variant="secondary" disabled={pending} className="h-8 px-2 text-xs">
        Reject
      </Button>
      {state.error ? <span className="w-full text-right text-xs text-danger">{state.error}</span> : null}
    </form>
  );
}
