"use client";

import { useActionState } from "react";
import { Alert, Button, Field, Input } from "@/components/ui";
import { confirmLink, sendCode, verifyCode, type FormState } from "./actions";

export function EmailForm() {
  const [state, action, pending] = useActionState<FormState, FormData>(sendCode, {});
  return (
    <form action={action} className="space-y-4">
      <Field label="Work email">
        <Input name="email" type="email" autoComplete="email" required autoFocus placeholder="you@autograff.ai" />
      </Field>
      {state.error ? <Alert tone="error">{state.error}</Alert> : null}
      <Button type="submit" disabled={pending} className="w-full">
        {pending ? "Sending…" : "Email me a sign-in code"}
      </Button>
    </form>
  );
}

export function CodeForm() {
  const [state, action, pending] = useActionState<FormState, FormData>(verifyCode, {});
  return (
    <form action={action} className="space-y-4">
      <Field label="Code from the email">
        <Input
          name="code"
          inputMode="numeric"
          autoComplete="one-time-code"
          pattern="[0-9 ]*"
          maxLength={9}
          required
          autoFocus
          className="text-center tracking-[0.4em]"
        />
      </Field>
      {state.error ? <Alert tone="error">{state.error}</Alert> : null}
      <Button type="submit" disabled={pending} className="w-full">
        {pending ? "Checking…" : "Sign in"}
      </Button>
    </form>
  );
}

export function ConfirmLinkForm({ tokenHash, type }: { tokenHash: string; type: string }) {
  const [state, action, pending] = useActionState<FormState, FormData>(confirmLink, {});
  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="token_hash" value={tokenHash} />
      <input type="hidden" name="type" value={type} />
      {state.error ? <Alert tone="error">{state.error}</Alert> : null}
      <Button type="submit" disabled={pending} className="w-full">
        {pending ? "Signing in…" : "Continue to Content Studio"}
      </Button>
    </form>
  );
}
