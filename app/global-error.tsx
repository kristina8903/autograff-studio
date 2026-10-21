"use client";

import "./globals.css";

// Last-resort error page (replaces the root layout); no details are shown.
export default function GlobalError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="en">
      <body className="flex min-h-screen items-center justify-center p-8">
        <div className="space-y-4 text-center">
          <h1 className="text-lg font-semibold">Something went wrong</h1>
          <button type="button" onClick={reset} className="text-sm text-accent underline">
            Try again
          </button>
        </div>
      </body>
    </html>
  );
}
