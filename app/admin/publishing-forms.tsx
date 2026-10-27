"use client";

import { useActionState, useState, useTransition } from "react";
import { Alert, Button, Field, Input, Select, Textarea } from "@/components/ui";
import { METRIC_KEYS, METRIC_LABELS } from "@/lib/domain/reports";
import {
  addMetricsAction,
  approvedTextAction,
  recordExternalAction,
  recordPublicationAction,
  scheduleDraftAction,
  setExamplesAction,
  unscheduleDraftAction,
  type ActionState,
} from "./publishing-actions";

function Result({ state }: { state: ActionState }) {
  if (state.error) return <Alert tone="error">{state.error}</Alert>;
  if (state.message) return <Alert tone="success">{state.message}</Alert>;
  return null;
}

/** Copies the approved text as the server returns it, never the text on screen. */
export function CopyApprovedButton({ draftId }: { draftId: string }) {
  const [status, setStatus] = useState<{ ok?: string; error?: string }>({});
  const [pending, start] = useTransition();
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button
        type="button"
        disabled={pending}
        onClick={() =>
          start(async () => {
            const result = await approvedTextAction(draftId);
            if (result.error || result.text === undefined) return setStatus({ error: result.error ?? "Not copied." });
            try {
              await navigator.clipboard.writeText(result.text);
              setStatus({ ok: "Copied the approved text." });
            } catch {
              setStatus({ error: "The browser blocked the clipboard. Select the text above and copy it." });
            }
          })
        }
      >
        Copy approved text
      </Button>
      {status.ok ? (
        <span role="status" className="text-sm text-success">
          {status.ok}
        </span>
      ) : null}
      {status.error ? (
        <span role="alert" className="text-sm text-danger">
          {status.error}
        </span>
      ) : null}
    </div>
  );
}

export function ScheduleForm({
  draftId,
  defaultTime,
  slots,
  currentSlotId,
  scheduled,
  timeZone,
}: {
  draftId: string;
  defaultTime: string;
  slots: { id: string; label: string }[];
  currentSlotId: string | null;
  scheduled: boolean;
  timeZone: string;
}) {
  const [state, action, pending] = useActionState<ActionState, FormData>(scheduleDraftAction, {});
  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="draft_id" value={draftId} />
      <Field label="Publish on" hint={`In the founder's time zone (${timeZone.replaceAll("_", " ")}).`}>
        <Input type="datetime-local" name="scheduled_for" required defaultValue={defaultTime} />
      </Field>
      <Field label="Calendar slot (optional)" hint="The time must be on the slot's day.">
        <Select name="slot_id" defaultValue={currentSlotId ?? ""}>
          <option value="">No slot</option>
          {slots.map((s) => (
            <option key={s.id} value={s.id}>
              {s.label}
            </option>
          ))}
        </Select>
      </Field>
      <Button type="submit" variant="secondary" disabled={pending}>
        {scheduled ? "Reschedule" : "Schedule"}
      </Button>
      <Result state={state} />
    </form>
  );
}

export function UnscheduleButton({ draftId }: { draftId: string }) {
  const [state, action, pending] = useActionState<ActionState, FormData>(unscheduleDraftAction, {});
  return (
    <form action={action} className="space-y-2">
      <input type="hidden" name="draft_id" value={draftId} />
      <Button type="submit" variant="secondary" disabled={pending}>
        Unschedule
      </Button>
      <Result state={state} />
    </form>
  );
}

/**
 * Field values kept when a save is refused: React resets a form after its
 * action runs, which would throw away what was typed or pasted. Cleared after
 * a successful save.
 */
function useKeptFields<T extends Record<string, string>>(initial: T) {
  const [values, setValues] = useState<T>(initial);
  const bind = (name: keyof T & string) => ({
    name,
    value: values[name],
    onChange: (e: { target: { value: string } }) => setValues((v) => ({ ...v, [name]: e.target.value })),
  });
  return {
    bind,
    set: (patch: Partial<T>) => setValues((v) => ({ ...v, ...patch })),
    reset: () => setValues(initial),
  };
}

/** Runs the action, and clears the kept fields only if it succeeded. */
function clearingOnSuccess(
  run: (state: ActionState, form: FormData) => Promise<ActionState>,
  reset: () => void,
): (state: ActionState, form: FormData) => Promise<ActionState> {
  return async (state, form) => {
    const result = await run(state, form);
    if (!result.error) reset();
    return result;
  };
}

export function RecordPublicationForm({ draftId, defaultTime }: { draftId: string; defaultTime: string }) {
  const fields = useKeptFields({ published_at: defaultTime, linkedin_url: "", published_text: "" });
  const [state, action, pending] = useActionState<ActionState, FormData>(
    clearingOnSuccess(recordPublicationAction, fields.reset),
    {},
  );
  const [asApproved, setAsApproved] = useState(true);
  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="draft_id" value={draftId} />
      <Field label="Published at" hint="In the founder's time zone.">
        <Input type="datetime-local" required {...fields.bind("published_at")} />
      </Field>
      <Field label="LinkedIn link">
        <Input type="url" required placeholder="https://www.linkedin.com/posts/…" {...fields.bind("linkedin_url")} />
      </Field>
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          name="as_approved"
          checked={asApproved}
          onChange={(e) => setAsApproved(e.target.checked)}
        />
        Posted exactly as approved
      </label>
      {asApproved ? null : (
        <Field
          label="Text as posted"
          hint="Paste it from LinkedIn. Differences from the approved text are shown and logged."
        >
          <Textarea rows={8} maxLength={6000} required {...fields.bind("published_text")} />
        </Field>
      )}
      <Button type="submit" disabled={pending}>
        {pending ? "Recording…" : "Record publication"}
      </Button>
      <Result state={state} />
    </form>
  );
}

export function ExternalPublicationForm({
  founders,
}: {
  /** `now`: the current time on the founder's own clock, the default publication time. */
  founders: { id: string; label: string; now: string }[];
}) {
  const fields = useKeptFields({ founder_id: "", published_at: "", linkedin_url: "", published_text: "" });
  const [state, action, pending] = useActionState<ActionState, FormData>(
    clearingOnSuccess(recordExternalAction, fields.reset),
    {},
  );
  return (
    <form action={action} className="space-y-3">
      <Field label="Founder">
        <Select
          required
          {...fields.bind("founder_id")}
          onChange={(e) => {
            const founder = founders.find((f) => f.id === e.target.value);
            fields.set({ founder_id: e.target.value, ...(founder ? { published_at: founder.now } : {}) });
          }}
        >
          <option value="" disabled>
            Choose…
          </option>
          {founders.map((f) => (
            <option key={f.id} value={f.id}>
              {f.label}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="Published at" hint="In the founder's time zone.">
        <Input type="datetime-local" required {...fields.bind("published_at")} />
      </Field>
      <Field label="LinkedIn link">
        <Input type="url" required placeholder="https://www.linkedin.com/posts/…" {...fields.bind("linkedin_url")} />
      </Field>
      <Field label="Text as posted">
        <Textarea rows={5} maxLength={6000} required {...fields.bind("published_text")} />
      </Field>
      <Button type="submit" variant="secondary" disabled={pending}>
        Record external post
      </Button>
      <Result state={state} />
    </form>
  );
}

const NO_METRICS = Object.fromEntries(METRIC_KEYS.map((k) => [k, ""])) as Record<(typeof METRIC_KEYS)[number], string>;

export function MetricsForm({ publicationId, draftId }: { publicationId: string; draftId?: string }) {
  const fields = useKeptFields(NO_METRICS);
  const [state, action, pending] = useActionState<ActionState, FormData>(
    clearingOnSuccess(addMetricsAction, fields.reset),
    {},
  );
  return (
    <form action={action} className="space-y-2" aria-label="Add metrics">
      <input type="hidden" name="publication_id" value={publicationId} />
      {draftId ? <input type="hidden" name="draft_id" value={draftId} /> : null}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {METRIC_KEYS.map((key) => (
          <Field key={key} label={METRIC_LABELS[key]}>
            <Input inputMode="numeric" className="h-8 text-xs" {...fields.bind(key)} />
          </Field>
        ))}
      </div>
      <Button type="submit" variant="secondary" disabled={pending} className="h-8 px-2 text-xs">
        Save metrics as of now
      </Button>
      <Result state={state} />
    </form>
  );
}

export function ExamplesSettingForm({ on }: { on: boolean }) {
  const [state, action, pending] = useActionState<ActionState, FormData>(setExamplesAction, {});
  return (
    <form action={action} className="space-y-2">
      <label className="flex items-start gap-2 text-sm">
        <input type="checkbox" name="on" defaultChecked={on} className="mt-1" />
        Add each published studio post to its founder&apos;s writing examples (not approved for voice until you approve
        it).
      </label>
      <Button type="submit" variant="secondary" disabled={pending} className="h-8 px-2 text-xs">
        Save
      </Button>
      <Result state={state} />
    </form>
  );
}
