"use client";

import { useActionState } from "react";
import { Alert, Button, Field, Input, Select } from "@/components/ui";
import { COMMON_TIME_ZONES } from "@/lib/domain/founders";
import {
  createFounder,
  deactivateUserAction,
  inviteFounderAction,
  updateFounder,
  type FounderFormState,
  type SimpleState,
} from "./actions";

type FounderValues = {
  id?: string;
  role_title: string;
  display_name: string;
  linkedin_profile_url: string | null;
  timezone: string;
};

export function FounderForm({ founder, allTimeZones }: { founder?: FounderValues; allTimeZones: string[] }) {
  const [state, action, pending] = useActionState<FounderFormState, FormData>(
    founder?.id ? updateFounder : createFounder,
    {},
  );
  const zones = [...COMMON_TIME_ZONES, ...allTimeZones.filter((zone) => !COMMON_TIME_ZONES.includes(zone))];
  return (
    <form action={action} className="space-y-4">
      {founder?.id ? <input type="hidden" name="id" value={founder.id} /> : null}
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Name" error={state.errors?.display_name}>
          <Input name="display_name" defaultValue={founder?.display_name} required maxLength={120} />
        </Field>
        <Field label="Role" hint="For example CEO, CTO, COO." error={state.errors?.role_title}>
          <Input name="role_title" defaultValue={founder?.role_title} required maxLength={60} />
        </Field>
      </div>
      <Field label="LinkedIn profile URL" hint="Optional." error={state.errors?.linkedin_profile_url}>
        <Input
          name="linkedin_profile_url"
          type="url"
          defaultValue={founder?.linkedin_profile_url ?? ""}
          placeholder="https://www.linkedin.com/in/name"
        />
      </Field>
      <Field label="Time zone" hint="Used for publishing days and times." error={state.errors?.timezone}>
        <Select name="timezone" defaultValue={founder?.timezone ?? "America/Los_Angeles"}>
          {zones.map((zone) => (
            <option key={zone} value={zone}>
              {zone.replaceAll("_", " ")}
            </option>
          ))}
        </Select>
      </Field>
      {state.error ? <Alert tone="error">{state.error}</Alert> : null}
      {state.saved ? <Alert tone="success">Saved.</Alert> : null}
      <Button type="submit" disabled={pending}>
        {pending ? "Saving…" : founder?.id ? "Save changes" : "Add founder"}
      </Button>
    </form>
  );
}

export function InviteForm({ founderId, domains }: { founderId: string; domains: string[] }) {
  const [state, action, pending] = useActionState<SimpleState, FormData>(inviteFounderAction, {});
  if (state.ok) return <Alert tone="success">Invitation sent. The link in it expires after one hour.</Alert>;
  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="founder_id" value={founderId} />
      <Field label="Work email" hint={`Only ${domains.map((d) => "@" + d).join(", ")} addresses can be invited.`}>
        <Input name="email" type="email" required placeholder={`name@${domains[0] ?? "autograff.ai"}`} />
      </Field>
      {state.error ? <Alert tone="error">{state.error}</Alert> : null}
      <Button type="submit" disabled={pending}>
        {pending ? "Sending…" : "Send invitation"}
      </Button>
    </form>
  );
}

export function DeactivateButton({ userId, label }: { userId: string; label: string }) {
  const [state, action, pending] = useActionState<SimpleState, FormData>(deactivateUserAction, {});
  return (
    <form
      action={action}
      onSubmit={(event) => {
        if (!window.confirm(`Deactivate ${label}? They lose access immediately.`)) event.preventDefault();
      }}
      className="inline"
    >
      <input type="hidden" name="user_id" value={userId} />
      <Button type="submit" variant="danger" disabled={pending} className="h-7 px-2 text-xs">
        {pending ? "…" : "Deactivate"}
      </Button>
      {state.error ? <span className="ml-2 text-xs text-danger">{state.error}</span> : null}
    </form>
  );
}
