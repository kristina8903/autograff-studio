import type { Metadata } from "next";
import Link from "next/link";
import { AuthShell } from "@/components/auth-shell";
import { CodeForm } from "../forms";

export const metadata: Metadata = { title: "Enter your code" };

export default function VerifyPage() {
  return (
    <AuthShell
      title="Check your email"
      description="If that address has access, we've sent it a 6-digit code. It expires in one hour."
    >
      <CodeForm />
      <p className="mt-4 text-center text-sm text-muted">
        <Link href="/sign-in" className="underline underline-offset-4">
          Use a different address or resend
        </Link>
      </p>
    </AuthShell>
  );
}
