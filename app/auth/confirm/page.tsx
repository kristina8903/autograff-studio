import type { Metadata } from "next";
import Link from "next/link";
import { AuthShell } from "@/components/auth-shell";
import { Alert } from "@/components/ui";
import { parseAuthLinkType } from "@/lib/domain/access";
import { ConfirmLinkForm } from "@/app/sign-in/forms";

export const metadata: Metadata = { title: "Continue" };

// The one-time token is spent only when the person presses Continue (a POST),
// so email security scanners that open links cannot use it up.
export default async function ConfirmPage({ searchParams }: PageProps<"/auth/confirm">) {
  const params = await searchParams;
  const tokenHash = typeof params.token_hash === "string" ? params.token_hash : "";
  const type = parseAuthLinkType(typeof params.type === "string" ? params.type : null);
  const invited = type === "invite";

  return (
    <AuthShell
      title={invited ? "Accept your invitation" : "Sign in"}
      description={
        invited ? "You've been invited to Autograff Content Studio." : "Continue to sign in to Content Studio."
      }
    >
      {tokenHash && type ? (
        <ConfirmLinkForm tokenHash={tokenHash} type={type} />
      ) : (
        <div className="space-y-4">
          <Alert tone="error">This link is incomplete or has expired.</Alert>
          <Link href="/sign-in" className="block text-center text-sm underline underline-offset-4">
            Request a sign-in code
          </Link>
        </div>
      )}
    </AuthShell>
  );
}
