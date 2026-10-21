"use client";

import { AuthShell } from "@/components/auth-shell";
import { Button } from "@/components/ui";

// Never shows error details: they can contain internal information.
export default function ErrorPage({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <AuthShell title="Something went wrong" description="The problem has been logged. Try again in a moment.">
      <Button onClick={reset}>Try again</Button>
    </AuthShell>
  );
}
