import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AuthShell } from "@/components/auth-shell";
import { getViewer, homePathFor } from "@/lib/auth/dal";
import { EmailForm } from "./forms";

export const metadata: Metadata = { title: "Sign in" };

export default async function SignInPage() {
  const viewer = await getViewer();
  if (viewer) redirect(homePathFor(viewer.role));
  return (
    <AuthShell title="Sign in" description="Content Studio is invite-only. We'll email you a one-time code.">
      <EmailForm />
    </AuthShell>
  );
}
