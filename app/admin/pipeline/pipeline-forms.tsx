"use client";

import { useActionState, useState } from "react";
import { Alert, Button } from "@/components/ui";
import { replenishAction, type ActionState } from "../concept-actions";

/**
 * Replenishment, confirmed before it runs (PRODUCT_SPEC §5.4). It only asks
 * for concepts: nothing on this page approves, schedules or publishes.
 */
export function ReplenishForm({
  founderId,
  founderName,
  month,
  monthName,
  batch,
  nonce,
}: {
  founderId: string;
  founderName: string;
  month: string;
  monthName: string;
  batch: number;
  nonce: string;
}) {
  const [state, action, pending] = useActionState<ActionState, FormData>(replenishAction, {});
  const [confirming, setConfirming] = useState(false);
  if (state.message) return <Alert tone="success">{state.message}</Alert>;
  return (
    <div className="space-y-2">
      {confirming ? (
        <form action={action} className="space-y-2 rounded-md border border-border p-3">
          <input type="hidden" name="founder_id" value={founderId} />
          <input type="hidden" name="month" value={month} />
          <input type="hidden" name="count" value={batch} />
          <input type="hidden" name="nonce" value={nonce} />
          <p className="text-sm">
            Ask the AI for {batch} new concept{batch === 1 ? "" : "s"} for {founderName} in {monthName}? They arrive as
            proposals on the Concepts page, for you to select or reject. Nothing is drafted, approved or scheduled.
          </p>
          <div className="flex gap-2">
            <Button type="submit" disabled={pending} className="h-8 px-3 text-xs">
              {pending ? "Requesting…" : `Confirm: generate ${batch}`}
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
          Generate {batch} concept{batch === 1 ? "" : "s"}…
        </Button>
      )}
      {state.error ? <Alert tone="error">{state.error}</Alert> : null}
    </div>
  );
}
