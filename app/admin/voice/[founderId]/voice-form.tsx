"use client";

import { useActionState } from "react";
import { Alert, Button, Field, Input, Select, Textarea } from "@/components/ui";
import { POST_FORMATS } from "@/lib/domain/formats";
import { HUMOR_LEVELS, LIST_FIELDS, SENTENCE_LENGTHS, TECHNICAL_DEPTHS, type VoiceProfile } from "@/lib/domain/voice";
import { saveVoiceProfile, type ActionState } from "../../voice-actions";

const capitalize = (value: string) => value[0].toUpperCase() + value.slice(1);

export function VoiceForm({
  founderId,
  profile,
  nextVersion,
  signals,
}: {
  founderId: string;
  profile: VoiceProfile;
  nextVersion: number;
  signals: { id: string; statement: string; kind: string }[];
}) {
  const [state, action, pending] = useActionState<ActionState, FormData>(saveVoiceProfile, {});
  const errors = state.errors ?? {};
  const a = profile.attributes;
  return (
    <form action={action} className="space-y-5">
      <input type="hidden" name="founder_id" value={founderId} />
      {signals.length ? (
        <section aria-label="Feedback being applied" className="rounded-md border border-accent/40 bg-accent/5 p-4">
          <h3 className="mb-1 text-sm font-semibold">Applying feedback</h3>
          <p className="mb-2 text-xs text-muted">
            Edit the profile below to reflect it. Saving accepts the feedback and records this version as its result.
          </p>
          <ul className="list-disc pl-5 text-sm">
            {signals.map((signal) => (
              <li key={signal.id}>
                <input type="hidden" name="feedback_id" value={signal.id} />
                {signal.statement}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-3">
        <Field label="Sentence length" error={errors.sentenceLength}>
          <Select name="sentenceLength" defaultValue={a.sentenceLength ?? ""}>
            <option value="">Not set</option>
            {SENTENCE_LENGTHS.map((v) => (
              <option key={v} value={v}>
                {capitalize(v)}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Humor" error={errors.humor}>
          <Select name="humor" defaultValue={a.humor ?? ""}>
            <option value="">Not set</option>
            {HUMOR_LEVELS.map((v) => (
              <option key={v} value={v}>
                {capitalize(v)}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Technical depth" error={errors.technicalDepth}>
          <Select name="technicalDepth" defaultValue={a.technicalDepth ?? ""}>
            <option value="">Not set</option>
            {TECHNICAL_DEPTHS.map((v) => (
              <option key={v} value={v}>
                {capitalize(v)}
              </option>
            ))}
          </Select>
        </Field>
      </div>
      <div className="grid gap-4 sm:grid-cols-3">
        <Field label="Paragraph structure" error={errors.paragraphStyle}>
          <Textarea name="paragraphStyle" defaultValue={a.paragraphStyle} rows={2} maxLength={500} />
        </Field>
        <Field label="Anecdotes" hint="How and how often they tell stories." error={errors.anecdotes}>
          <Textarea name="anecdotes" defaultValue={a.anecdotes} rows={2} maxLength={500} />
        </Field>
        <Field label="Point of view and style" error={errors.pointOfView}>
          <Textarea name="pointOfView" defaultValue={a.pointOfView} rows={2} maxLength={500} />
        </Field>
      </div>

      <p className="text-xs text-muted">For the lists below, put one item per line.</p>
      <div className="grid gap-4 sm:grid-cols-2">
        {LIST_FIELDS.map(([key, label, hint]) => (
          <Field key={key} label={label} hint={hint || undefined} error={errors[key]}>
            <Textarea name={key} defaultValue={profile[key].join("\n")} rows={3} />
          </Field>
        ))}
      </div>

      <fieldset className="space-y-3">
        <legend className="text-sm font-semibold">Format preferences</legend>
        <p className="text-xs text-muted">
          Only for formats where this founder writes differently. Leave the rest empty.
        </p>
        <div className="grid gap-4 sm:grid-cols-3">
          {POST_FORMATS.map(([value, label]) => (
            <Field key={value} label={label}>
              <Input name={`format:${value}`} defaultValue={profile.formatPreferences[value] ?? ""} maxLength={500} />
            </Field>
          ))}
        </div>
        {errors.formatPreferences ? <Alert tone="error">{errors.formatPreferences}</Alert> : null}
      </fieldset>

      <Field label="Notes" error={errors.notes}>
        <Textarea name="notes" defaultValue={profile.notes} rows={3} maxLength={4000} />
      </Field>

      <div className="flex flex-wrap items-end gap-4 border-t border-border pt-4">
        <Field label="Reason for the change" error={errors.changeReason}>
          <Input
            name="changeReason"
            maxLength={500}
            required
            className="w-80"
            defaultValue={signals.length ? "Applied founder feedback" : ""}
          />
        </Field>
        <Button type="submit" disabled={pending}>
          {pending ? "Saving…" : `Save as version ${nextVersion}`}
        </Button>
      </div>
      {state.error ? <Alert tone="error">{state.error}</Alert> : null}
    </form>
  );
}
