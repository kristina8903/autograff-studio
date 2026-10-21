"use client";

import { useActionState } from "react";
import { Alert, Button, Field, Input, Select, Textarea } from "@/components/ui";
import { POST_FORMATS } from "@/lib/domain/formats";
import { addExampleAction, bulkAddExamplesAction, updateExampleAction, type ActionState } from "../../../voice-actions";

function FormatSelect({ defaultValue, label = "Format" }: { defaultValue?: string | null; label?: string }) {
  return (
    <Field label={label}>
      <Select name="format" defaultValue={defaultValue ?? ""}>
        <option value="">No format</option>
        {POST_FORMATS.map(([value, text]) => (
          <option key={value} value={value}>
            {text}
          </option>
        ))}
      </Select>
    </Field>
  );
}

function Result({ state }: { state: ActionState }) {
  if (state.error) return <Alert tone="error">{state.error}</Alert>;
  if (state.message) return <Alert tone="success">{state.message}</Alert>;
  return null;
}

export function AddExampleForm({ founderId }: { founderId: string }) {
  const [state, action, pending] = useActionState<ActionState, FormData>(addExampleAction, {});
  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="founder_id" value={founderId} />
      <Field label="Post text">
        <Textarea name="body" rows={5} required maxLength={10000} />
      </Field>
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Kind">
          <Select name="kind" defaultValue="published_linkedin">
            <option value="published_linkedin">Published LinkedIn post</option>
            <option value="approved_example">Approved example</option>
            <option value="other">Other</option>
          </Select>
        </Field>
        <Field label="LinkedIn URL (optional)">
          <Input name="source_url" type="url" placeholder="https://www.linkedin.com/posts/…" />
        </Field>
        <Field label="Published on (optional)">
          <Input name="published_at" type="date" />
        </Field>
        <FormatSelect />
        <Field label="Topics" hint="Comma-separated.">
          <Input name="topics" placeholder="repair status, fleets" />
        </Field>
      </div>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" name="approved_for_voice" defaultChecked /> Approved for voice
      </label>
      <Button type="submit" disabled={pending}>
        {pending ? "Adding…" : "Add example"}
      </Button>
      <Result state={state} />
    </form>
  );
}

export function BulkAddForm({ founderId }: { founderId: string }) {
  const [state, action, pending] = useActionState<ActionState, FormData>(bulkAddExamplesAction, {});
  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="founder_id" value={founderId} />
      <Field
        label="Posts"
        hint='Separate posts with a line of three dashes (---). A post may start with "URL: https://…" and "Date: 2026-09-15" lines.'
      >
        <Textarea
          name="posts"
          rows={8}
          required
          placeholder={"URL: https://www.linkedin.com/posts/…\nDate: 2026-09-15\nFirst post…\n---\nSecond post…"}
        />
      </Field>
      <div className="grid gap-3 sm:grid-cols-2">
        <FormatSelect label="Format for all (optional)" />
        <Field label="Topics for all" hint="Comma-separated. You can edit each post afterwards.">
          <Input name="topics" />
        </Field>
      </div>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" name="approved_for_voice" defaultChecked /> Approve all for voice
      </label>
      <Button type="submit" variant="secondary" disabled={pending}>
        {pending ? "Adding…" : "Add posts"}
      </Button>
      <Result state={state} />
    </form>
  );
}

export function ExampleSettings({
  founderId,
  example,
}: {
  founderId: string;
  example: { id: string; approved_for_voice: boolean; eval_holdout: boolean; format: string | null; topics: string[] };
}) {
  const [state, action, pending] = useActionState<ActionState, FormData>(updateExampleAction, {});
  return (
    <form action={action} className="flex flex-wrap items-end gap-3 text-sm">
      <input type="hidden" name="founder_id" value={founderId} />
      <input type="hidden" name="example_id" value={example.id} />
      <label className="flex items-center gap-1.5">
        <input type="checkbox" name="approved_for_voice" defaultChecked={example.approved_for_voice} /> Approved for
        voice
      </label>
      <label className="flex items-center gap-1.5" title="Kept out of retrieval and used to evaluate generated drafts">
        <input type="checkbox" name="eval_holdout" defaultChecked={example.eval_holdout} /> Held out for evaluation
      </label>
      <Select name="format" defaultValue={example.format ?? ""} aria-label="Format" className="h-8 w-40 text-xs">
        <option value="">No format</option>
        {POST_FORMATS.map(([value, text]) => (
          <option key={value} value={value}>
            {text}
          </option>
        ))}
      </Select>
      <Input
        name="topics"
        defaultValue={example.topics.join(", ")}
        aria-label="Topics"
        placeholder="Topics"
        className="h-8 w-56 text-xs"
      />
      <Button type="submit" variant="secondary" disabled={pending} className="h-8 px-2 text-xs">
        Save
      </Button>
      <Button
        type="submit"
        name="intent"
        value="delete"
        variant="danger"
        disabled={pending}
        className="h-8 px-2 text-xs"
        onClick={(event) => {
          if (!confirm("Delete this example?")) event.preventDefault();
        }}
      >
        Delete
      </Button>
      {state.error ? <span className="text-xs text-danger">{state.error}</span> : null}
      {state.message ? <span className="text-xs text-success">{state.message}</span> : null}
    </form>
  );
}
