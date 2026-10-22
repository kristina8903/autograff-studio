"use client";

import { useActionState, useState } from "react";
import { Alert, Button, Field, Input, Select, Textarea } from "@/components/ui";
import { POST_FORMATS } from "@/lib/domain/formats";
import {
  regenerateConceptAction,
  requestConceptsAction,
  setConceptStatusAction,
  updateConceptAction,
  type ActionState,
} from "../concept-actions";

function Result({ state }: { state: ActionState }) {
  if (state.error) return <Alert tone="error">{state.error}</Alert>;
  if (state.message) return <Alert tone="success">{state.message}</Alert>;
  return null;
}

export function GenerateForm({
  founderId,
  founderName,
  month,
  suggested,
  max,
  nonce,
}: {
  founderId: string;
  founderName: string;
  month: string;
  suggested: number;
  max: number;
  nonce: string;
}) {
  const [state, action, pending] = useActionState<ActionState, FormData>(requestConceptsAction, {});
  return (
    <form action={action} className="flex flex-wrap items-end gap-3">
      <input type="hidden" name="founder_id" value={founderId} />
      <input type="hidden" name="month" value={month} />
      <input type="hidden" name="nonce" value={nonce} />
      <Field label={`Concepts for ${founderName}`}>
        <Select name="count" defaultValue={String(Math.max(1, suggested))} className="w-24">
          {Array.from({ length: max }, (_, i) => i + 1).map((n) => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
        </Select>
      </Field>
      <Button type="submit" disabled={pending}>
        {pending ? "Requesting…" : "Generate concepts"}
      </Button>
      <div className="w-full">
        <Result state={state} />
      </div>
    </form>
  );
}

export function StatusButtons({ conceptId, status }: { conceptId: string; status: string }) {
  const [state, action, pending] = useActionState<ActionState, FormData>(setConceptStatusAction, {});
  const button = (to: string, label: string, variant: "primary" | "secondary" | "danger" = "secondary") => (
    <Button name="status" value={to} variant={variant} disabled={pending} className="h-8 px-2 text-xs">
      {label}
    </Button>
  );
  return (
    <form action={action} className="flex flex-wrap items-center gap-2">
      <input type="hidden" name="concept_id" value={conceptId} />
      {status === "proposed" ? (
        <>
          {button("selected", "Select", "primary")}
          {button("rejected", "Reject", "danger")}
        </>
      ) : status === "selected" ? (
        <>
          {button("proposed", "Unselect")}
          {button("rejected", "Reject", "danger")}
        </>
      ) : status === "rejected" ? (
        button("proposed", "Restore")
      ) : null}
      {state.error ? <span className="text-xs text-danger">{state.error}</span> : null}
    </form>
  );
}

export function RegenerateForm({ conceptId, nonce }: { conceptId: string; nonce: string }) {
  const [state, action, pending] = useActionState<ActionState, FormData>(regenerateConceptAction, {});
  const [open, setOpen] = useState(false);
  if (!open)
    return (
      <Button type="button" variant="secondary" className="h-8 px-2 text-xs" onClick={() => setOpen(true)}>
        Regenerate
      </Button>
    );
  return (
    <form action={action} className="flex w-full flex-wrap items-end gap-2">
      <input type="hidden" name="concept_id" value={conceptId} />
      <input type="hidden" name="nonce" value={nonce} />
      <Field label="What should be different? (optional)">
        <Input name="guidance" maxLength={500} className="w-80" placeholder="e.g. More practical, less abstract" />
      </Field>
      <Button type="submit" disabled={pending} className="h-9">
        {pending ? "Requesting…" : "Regenerate this concept"}
      </Button>
      <button type="button" className="text-xs text-muted hover:underline" onClick={() => setOpen(false)}>
        Cancel
      </button>
      <div className="w-full">
        <Result state={state} />
      </div>
    </form>
  );
}

export function EditConceptForm({
  concept,
}: {
  concept: {
    id: string;
    title: string;
    audience: string;
    core_argument: string;
    hook: string;
    format: string;
    why_this_founder: string;
    evidence_requirements: string[];
  };
}) {
  const [state, action, pending] = useActionState<ActionState, FormData>(updateConceptAction, {});
  const [open, setOpen] = useState(false);
  if (!open)
    return (
      <Button type="button" variant="secondary" className="h-8 px-2 text-xs" onClick={() => setOpen(true)}>
        Edit
      </Button>
    );
  return (
    <form action={action} className="w-full space-y-3 rounded-md border border-border p-3">
      <input type="hidden" name="concept_id" value={concept.id} />
      <Field label="Title">
        <Input name="title" defaultValue={concept.title} maxLength={200} required />
      </Field>
      <Field label="Core argument">
        <Textarea name="core_argument" defaultValue={concept.core_argument} rows={2} maxLength={1000} required />
      </Field>
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Hook">
          <Input name="hook" defaultValue={concept.hook} maxLength={500} />
        </Field>
        <Field label="Audience">
          <Input name="audience" defaultValue={concept.audience} maxLength={300} />
        </Field>
        <Field label="Format">
          <Select name="format" defaultValue={concept.format}>
            {POST_FORMATS.map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </Select>
        </Field>
      </div>
      <Field label="Why this founder">
        <Textarea name="why_this_founder" defaultValue={concept.why_this_founder} rows={2} maxLength={1000} />
      </Field>
      <Field label="Evidence needed" hint="One per line.">
        <Textarea name="evidence_requirements" defaultValue={concept.evidence_requirements.join("\n")} rows={2} />
      </Field>
      <div className="flex gap-2">
        <Button type="submit" disabled={pending}>
          {pending ? "Saving…" : "Save changes"}
        </Button>
        <Button type="button" variant="secondary" onClick={() => setOpen(false)}>
          Close
        </Button>
      </div>
      <Result state={state} />
    </form>
  );
}
