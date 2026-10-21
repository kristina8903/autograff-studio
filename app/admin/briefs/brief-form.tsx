"use client";

import { useActionState } from "react";
import { Alert, Button, Field, Input, Textarea } from "@/components/ui";
import { LIST_FIELDS, type BriefSnapshot } from "@/lib/domain/briefs";
import { saveBrief, type ActionState } from "../planning-actions";

export function BriefForm({
  month,
  title,
  snapshot,
  founders,
  nextVersion,
}: {
  month: string;
  title: string;
  snapshot: BriefSnapshot | null;
  founders: { id: string; label: string }[];
  nextVersion: number;
}) {
  const [state, action, pending] = useActionState<ActionState, FormData>(saveBrief, {});
  const errors = state.errors ?? {};
  return (
    <form action={action} className="space-y-5">
      <input type="hidden" name="month" value={month} />
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Theme" error={errors.theme}>
          <Input name="theme" defaultValue={snapshot?.content.theme} required maxLength={200} />
        </Field>
        <Field label="Short title" hint="Optional. Shown in the list of briefs.">
          <Input name="title" defaultValue={title} maxLength={200} />
        </Field>
      </div>
      <p className="text-xs text-muted">For the lists below, put one item per line.</p>
      <div className="grid gap-4 sm:grid-cols-2">
        {LIST_FIELDS.map(([key, label]) => (
          <Field key={key} label={label} error={errors[key]}>
            <Textarea name={key} defaultValue={snapshot?.content[key].join("\n")} rows={3} />
          </Field>
        ))}
      </div>

      <fieldset className="space-y-3">
        <legend className="text-sm font-semibold">Founder emphasis</legend>
        <p className="text-xs text-muted">
          How each founder should approach the theme from their own expertise. Each founder sees only the theme and
          their own emphasis.
        </p>
        {founders.length ? null : <p className="text-sm text-muted">Add founders first to give them emphasis.</p>}
        <div className="grid gap-4 sm:grid-cols-2">
          {founders.map((founder) => (
            <Field key={founder.id} label={founder.label}>
              <Textarea name={`emphasis:${founder.id}`} defaultValue={snapshot?.founderEmphasis[founder.id]} rows={3} />
            </Field>
          ))}
        </div>
        {errors.founderEmphasis ? <Alert tone="error">{errors.founderEmphasis}</Alert> : null}
      </fieldset>

      <Field
        label="Approved facts and messaging"
        hint="Facts the AI may state as fact, e.g. exact pricing with its conditions. One per line."
        error={errors.approvedFacts}
      >
        <Textarea name="approvedFacts" defaultValue={snapshot?.approvedFacts.join("\n")} rows={4} />
      </Field>

      <div className="flex flex-wrap items-end gap-4 border-t border-border pt-4">
        <Field label="What changed" hint="Optional note for the version history.">
          <Input name="changeNote" maxLength={500} className="w-80" />
        </Field>
        <Button type="submit" disabled={pending}>
          {pending ? "Saving…" : `Save as version ${nextVersion}`}
        </Button>
      </div>
      {state.error ? <Alert tone="error">{state.error}</Alert> : null}
    </form>
  );
}
