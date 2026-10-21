"use client";

import { useActionState, useState, useTransition } from "react";
import { Alert, Button, Field, Input } from "@/components/ui";
import { startEnrollment, verifyFactor, type EnrollState, type VerifyState } from "./actions";

function CodeField() {
  return (
    <Field label="6-digit code from your app">
      <Input
        name="code"
        inputMode="numeric"
        autoComplete="one-time-code"
        pattern="[0-9 ]*"
        maxLength={7}
        required
        autoFocus
        className="text-center tracking-[0.4em]"
      />
    </Field>
  );
}

export function VerifyFactorForm({ factorId }: { factorId: string }) {
  const [state, action, pending] = useActionState<VerifyState, FormData>(verifyFactor, {});
  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="factor_id" value={factorId} />
      <CodeField />
      {state.error ? <Alert tone="error">{state.error}</Alert> : null}
      <Button type="submit" disabled={pending} className="w-full">
        {pending ? "Checking…" : "Verify"}
      </Button>
    </form>
  );
}

export function EnrollForm() {
  const [enrollment, setEnrollment] = useState<EnrollState>({});
  const [starting, startTransition] = useTransition();

  if (!enrollment.factorId) {
    return (
      <div className="space-y-4">
        {enrollment.error ? <Alert tone="error">{enrollment.error}</Alert> : null}
        <Button
          className="w-full"
          disabled={starting}
          onClick={() => startTransition(async () => setEnrollment(await startEnrollment()))}
        >
          {starting ? "Preparing…" : "Set up an authenticator app"}
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <ol className="list-decimal space-y-1 pl-5 text-sm text-muted">
        <li>Open an authenticator app (1Password, Google Authenticator, Authy…).</li>
        <li>Scan this code, or enter the setup key by hand.</li>
        <li>Enter the 6-digit code the app shows.</li>
      </ol>
      {/* eslint-disable-next-line @next/next/no-img-element -- data: URI from Supabase, not an optimizable image */}
      <img
        src={enrollment.qrCode}
        alt="QR code for your authenticator app"
        width={180}
        height={180}
        className="mx-auto rounded bg-white p-2"
      />
      <p className="text-center text-xs text-muted">
        Setup key:{" "}
        <code data-testid="totp-secret" className="font-mono text-foreground">
          {enrollment.secret}
        </code>
      </p>
      <VerifyFactorForm factorId={enrollment.factorId} />
    </div>
  );
}
