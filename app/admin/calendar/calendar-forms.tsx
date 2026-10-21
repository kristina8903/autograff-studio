"use client";

import { useActionState, useState } from "react";
import { Alert, Button, Field, Input, Select } from "@/components/ui";
import { addSlotAction, planMonthAction, updateSlotAction, type ActionState } from "../planning-actions";

export function PlanMonthForm({ month, label }: { month: string; label: string }) {
  const [state, action, pending] = useActionState<ActionState, FormData>(planMonthAction, {});
  return (
    <form action={action} className="space-y-2">
      <input type="hidden" name="month" value={month} />
      <Button type="submit" disabled={pending}>
        {pending ? "Planning…" : `Plan slots for ${label}`}
      </Button>
      {state.message ? <Alert tone="success">{state.message}</Alert> : null}
      {state.error ? <Alert tone="error">{state.error}</Alert> : null}
    </form>
  );
}

export function AddSlotForm({ founders, minDate }: { founders: { id: string; label: string }[]; minDate: string }) {
  const [state, action, pending] = useActionState<ActionState, FormData>(addSlotAction, {});
  return (
    <form action={action} className="flex flex-wrap items-end gap-3">
      <Field label="Founder">
        <Select name="founder_id" required className="w-48">
          {founders.map((f) => (
            <option key={f.id} value={f.id}>
              {f.label}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="Date">
        <Input type="date" name="date" min={minDate} required className="w-44" />
      </Field>
      <Field label="Note (optional)">
        <Input name="note" maxLength={200} placeholder="e.g. Product launch" className="w-56" />
      </Field>
      <Button type="submit" variant="secondary" disabled={pending}>
        {pending ? "Adding…" : "Add slot"}
      </Button>
      {state.error ? <Alert tone="error">{state.error}</Alert> : null}
    </form>
  );
}

export function SlotActions({
  slotId,
  status,
  kind,
  minDate,
}: {
  slotId: string;
  status: "open" | "filled" | "skipped";
  kind: "regular" | "reserved_timely" | "manual";
  minDate: string;
}) {
  const [state, action, pending] = useActionState<ActionState, FormData>(updateSlotAction, {});
  const [moving, setMoving] = useState(false);
  if (status === "filled") return <span className="text-xs text-muted">Filled</span>;
  return (
    <form action={action} className="flex flex-wrap items-center justify-end gap-2">
      <input type="hidden" name="slot_id" value={slotId} />
      {status === "skipped" ? (
        <Button name="action" value="unskip" variant="secondary" disabled={pending} className="h-7 px-2 text-xs">
          Restore
        </Button>
      ) : moving ? (
        <>
          <Input
            type="date"
            name="new_date"
            min={minDate}
            required
            className="h-7 w-36 text-xs"
            aria-label="New date"
          />
          <Button name="action" value="move" disabled={pending} className="h-7 px-2 text-xs">
            Move
          </Button>
          <button type="button" className="text-xs text-muted hover:underline" onClick={() => setMoving(false)}>
            Cancel
          </button>
        </>
      ) : (
        <>
          <Button type="button" variant="secondary" className="h-7 px-2 text-xs" onClick={() => setMoving(true)}>
            Move
          </Button>
          <Button name="action" value="skip" variant="secondary" disabled={pending} className="h-7 px-2 text-xs">
            Skip
          </Button>
          {kind === "manual" ? (
            <Button name="action" value="delete" variant="danger" disabled={pending} className="h-7 px-2 text-xs">
              Remove
            </Button>
          ) : null}
        </>
      )}
      {state.error ? <span className="w-full text-right text-xs text-danger">{state.error}</span> : null}
    </form>
  );
}
