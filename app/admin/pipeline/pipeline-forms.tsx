"use client";

import { useActionState, useState } from "react";
import { Alert, Button, Field, Input } from "@/components/ui";
import { replenishAction, setBatchSizesAction, type ActionState } from "../concept-actions";

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

/**
 * The top-up, confirmed before it runs (PRODUCT_SPEC §5.4): new concepts for
 * the need, and drafts of concepts already selected. Nothing on this page
 * approves, schedules or publishes.
 */
export function ReplenishForm({
  founderId,
  founderName,
  month,
  monthName,
  concepts,
  drafts,
  nonce,
}: {
  founderId: string;
  founderName: string;
  month: string;
  monthName: string;
  concepts: number;
  drafts: number;
  nonce: string;
}) {
  const [state, action, pending] = useActionState<ActionState, FormData>(replenishAction, {});
  const [confirming, setConfirming] = useState(false);
  if (state.message) return <Alert tone="success">{state.message}</Alert>;
  const parts = [
    concepts ? plural(concepts, "new concept") : "",
    drafts ? `${plural(drafts, "draft")} of selected concepts` : "",
  ].filter(Boolean);
  return (
    <div className="space-y-2">
      {confirming ? (
        <form action={action} className="space-y-2 rounded-md border border-border p-3">
          <input type="hidden" name="founder_id" value={founderId} />
          <input type="hidden" name="month" value={month} />
          <input type="hidden" name="concepts" value={concepts} />
          <input type="hidden" name="drafts" value={drafts} />
          <input type="hidden" name="nonce" value={nonce} />
          <p className="text-sm">
            Ask the AI for {parts.join(" and ")} for {founderName} in {monthName}?
            {concepts ? " New concepts arrive as proposals for you to select or reject." : ""}
            {drafts ? " Drafts go to admin review." : ""} Nothing is approved or scheduled.
          </p>
          <div className="flex gap-2">
            <Button type="submit" disabled={pending} className="h-8 px-3 text-xs">
              {pending ? "Requesting…" : "Confirm top-up"}
            </Button>
            <Button
              type="button"
              variant="secondary"
              disabled={pending}
              onClick={() => setConfirming(false)}
              className="h-8 px-3 text-xs"
            >
              Cancel
            </Button>
          </div>
        </form>
      ) : (
        <Button type="button" variant="secondary" onClick={() => setConfirming(true)} className="h-8 px-3 text-xs">
          Top up: {parts.join(" + ")}…
        </Button>
      )}
      {state.error ? <Alert tone="error">{state.error}</Alert> : null}
    </div>
  );
}

export function BatchSizesForm({
  concepts,
  drafts,
  maxConcepts,
  maxDrafts,
}: {
  concepts: number;
  drafts: number;
  maxConcepts: number;
  maxDrafts: number;
}) {
  const [state, action, pending] = useActionState<ActionState, FormData>(setBatchSizesAction, {});
  return (
    <form action={action} className="flex flex-wrap items-end gap-3" aria-label="Top-up batch sizes">
      <Field label="New concepts per top-up" hint={`1 to ${maxConcepts}`}>
        <Input
          name="concepts"
          type="number"
          min={1}
          max={maxConcepts}
          required
          defaultValue={concepts}
          className="w-24"
        />
      </Field>
      <Field label="Drafts per top-up" hint={`1 to ${maxDrafts}`}>
        <Input name="drafts" type="number" min={1} max={maxDrafts} required defaultValue={drafts} className="w-24" />
      </Field>
      <Button type="submit" variant="secondary" disabled={pending}>
        Save
      </Button>
      <div className="w-full">
        {state.error ? <Alert tone="error">{state.error}</Alert> : null}
        {state.message ? <Alert tone="success">{state.message}</Alert> : null}
      </div>
    </form>
  );
}
