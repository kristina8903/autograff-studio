"use client";

import { useActionState } from "react";
import { Alert, Button, Field, Textarea } from "@/components/ui";
import { shareExampleAction, type ActionState } from "./actions";

export function ShareExampleForm() {
  const [state, action, pending] = useActionState<ActionState, FormData>(shareExampleAction, {});
  return (
    <form action={action} className="space-y-3">
      <Field label="Something you wrote" hint="A post, a note or an email you're happy to have used as an example.">
        <Textarea name="body" rows={5} required maxLength={10000} />
      </Field>
      <Button type="submit" disabled={pending}>
        {pending ? "Sharing…" : "Share as an example"}
      </Button>
      {state.error ? <Alert tone="error">{state.error}</Alert> : null}
      {state.message ? <Alert tone="success">{state.message}</Alert> : null}
    </form>
  );
}
