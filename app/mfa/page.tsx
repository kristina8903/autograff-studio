import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { AuthShell } from "@/components/auth-shell";
import { SignOutButton } from "@/components/sign-out-button";
import { homePathFor, requireViewer } from "@/lib/auth/dal";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { EnrollForm, VerifyFactorForm } from "./forms";

export const metadata: Metadata = { title: "Two-factor sign-in" };

export default async function MfaPage() {
  const viewer = await requireViewer();
  if (viewer.currentLevel === "aal2") redirect(homePathFor(viewer.role));

  const supabase = await createSupabaseServerClient();
  const { data: factors } = await supabase.auth.mfa.listFactors();
  const verified = factors?.totp.find((factor) => factor.status === "verified");

  if (verified) {
    return (
      <AuthShell title="Two-factor sign-in" description="Enter the current code from your authenticator app.">
        <VerifyFactorForm factorId={verified.id} />
        <div className="mt-4 flex justify-center">
          <SignOutButton />
        </div>
      </AuthShell>
    );
  }

  const required = viewer.role === "admin";
  return (
    <AuthShell
      title="Set up two-factor sign-in"
      description={
        required
          ? "Admin accounts need an authenticator app. You'll enter a code from it each time you sign in."
          : "Optional for founders: protect your account with a code from an authenticator app."
      }
    >
      <EnrollForm />
      <div className="mt-4 flex items-center justify-center gap-4">
        {required ? null : (
          <Link href="/dashboard" className="text-sm text-muted underline underline-offset-4">
            Not now
          </Link>
        )}
        <SignOutButton />
      </div>
    </AuthShell>
  );
}
