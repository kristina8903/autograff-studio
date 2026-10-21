import type { ReactNode } from "react";
import { Card } from "./ui";

/** Centered single-card layout for sign-in, MFA and link confirmation. */
export function AuthShell({
  title,
  description,
  children,
}: {
  title: string;
  description?: ReactNode;
  children: ReactNode;
}) {
  return (
    <main className="flex flex-1 items-center justify-center px-4 py-12">
      <div className="w-full max-w-sm">
        <p className="mb-6 text-center text-sm font-semibold tracking-tight text-muted">Autograff Content Studio</p>
        <Card>
          <h1 className="text-lg font-semibold">{title}</h1>
          {description ? <p className="mt-1 mb-5 text-sm text-muted">{description}</p> : <div className="mb-5" />}
          {children}
        </Card>
      </div>
    </main>
  );
}
