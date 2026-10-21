"use client";

import { useActionState, useState } from "react";
import { Alert, Button, Field, Input, Select } from "@/components/ui";
import { CADENCE_PRESETS } from "@/lib/domain/cadence";
import { WEEKDAY_NAMES } from "@/lib/domain/dates";
import { setCadence, type ActionState } from "../../planning-actions";

export type CadenceDefaults = {
  period: "week" | "month";
  minPosts: number;
  maxPosts: number;
  weeklyPattern: number[] | null;
  publishingDays: number[];
  reservedTimely: number;
  bufferTarget: number;
  lowBufferThreshold: number;
  candidateMin: number;
  candidateMax: number;
};

export function CadenceForm({
  founderId,
  today,
  defaults,
}: {
  founderId: string;
  today: string;
  defaults: CadenceDefaults;
}) {
  const [state, action, pending] = useActionState<ActionState, FormData>(setCadence, {});
  const [values, setValues] = useState(defaults);
  // Bumped only by the preset buttons, to reset the uncontrolled fields to the preset.
  const [presetVersion, setPresetVersion] = useState(0);
  const [period, setPeriod] = useState(defaults.period);

  function applyPreset(preset: keyof typeof CADENCE_PRESETS, candidates: [number, number]) {
    const p = CADENCE_PRESETS[preset];
    setValues((current) => ({
      ...current,
      period: p.period,
      minPosts: p.minPosts,
      maxPosts: p.maxPosts,
      weeklyPattern: null,
      publishingDays: [...p.publishingDays],
      candidateMin: candidates[0],
      candidateMax: candidates[1],
    }));
    setPeriod(p.period);
    setPresetVersion((n) => n + 1);
  }

  return (
    <form action={action} className="space-y-4" key={presetVersion}>
      <input type="hidden" name="founder_id" value={founderId} />
      <div className="flex flex-wrap gap-2 text-sm">
        <span className="text-muted">Presets:</span>
        <button
          type="button"
          className="text-accent hover:underline"
          onClick={() => applyPreset("twoToThreePerWeek", [16, 20])}
        >
          2–3 a week (CEO/COO)
        </button>
        <span className="text-muted">·</span>
        <button
          type="button"
          className="text-accent hover:underline"
          onClick={() => applyPreset("twoPerMonth", [4, 6])}
        >
          2 a month (CTO)
        </button>
      </div>
      <div className="grid gap-4 sm:grid-cols-3">
        <Field label="Per">
          <Select
            name="period"
            defaultValue={values.period}
            onChange={(e) => setPeriod(e.target.value as "week" | "month")}
          >
            <option value="week">Week</option>
            <option value="month">Month</option>
          </Select>
        </Field>
        <Field label="Minimum posts">
          <Input name="min_posts" type="number" min={1} max={31} defaultValue={values.minPosts} />
        </Field>
        <Field label="Maximum posts">
          <Input name="max_posts" type="number" min={1} max={31} defaultValue={values.maxPosts} />
        </Field>
      </div>
      <fieldset>
        <legend className="mb-1.5 text-sm font-medium">Publishing days</legend>
        <div className="flex flex-wrap gap-3 text-sm">
          {WEEKDAY_NAMES.map((name, index) => (
            <label key={name} className="flex items-center gap-1.5">
              <input
                type="checkbox"
                name="publishing_days"
                value={index + 1}
                defaultChecked={values.publishingDays.includes(index + 1)}
              />
              {name}
            </label>
          ))}
        </div>
        <p className="mt-1 text-xs text-muted">Weekly posts go on the earliest chosen days of the week first.</p>
      </fieldset>
      {period === "week" ? (
        <Field
          label="Weekly pattern (optional)"
          hint="Alternate weekly targets, e.g. 3, 2. Leave empty to plan the maximum."
        >
          <Input
            name="weekly_pattern"
            defaultValue={values.weeklyPattern?.join(", ") ?? ""}
            placeholder="3, 2"
            className="w-40"
          />
        </Field>
      ) : null}
      <div className="grid gap-4 sm:grid-cols-3">
        <Field label="Reserved for news" hint="Slots per month kept free for timely posts.">
          <Input name="reserved_timely" type="number" min={0} max={31} defaultValue={values.reservedTimely} />
        </Field>
        <Field label="Approved posts to keep in hand">
          <Input name="buffer_target" type="number" min={0} max={50} defaultValue={values.bufferTarget} />
        </Field>
        <Field label="Warn when buffer falls below">
          <Input name="low_buffer_threshold" type="number" min={0} max={50} defaultValue={values.lowBufferThreshold} />
        </Field>
        <Field label="Candidate drafts / month: min">
          <Input name="candidate_target_min" type="number" min={0} max={100} defaultValue={values.candidateMin} />
        </Field>
        <Field label="Candidate drafts / month: max">
          <Input name="candidate_target_max" type="number" min={0} max={100} defaultValue={values.candidateMax} />
        </Field>
        <Field label="Starts on" hint="Only open slots from this date are re-planned.">
          <Input name="effective_from" type="date" min={today} defaultValue={today} required />
        </Field>
      </div>
      <Field label="Reason for the change">
        <Input name="change_reason" maxLength={500} placeholder="e.g. Launch month: posting more often" />
      </Field>
      {state.error ? <Alert tone="error">{state.error}</Alert> : null}
      {state.message ? <Alert tone="success">{state.message}</Alert> : null}
      <Button type="submit" disabled={pending}>
        {pending ? "Saving…" : "Save cadence"}
      </Button>
    </form>
  );
}
