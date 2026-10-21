import Link from "next/link";
import { AuthShell } from "@/components/auth-shell";

// Replaces Next's default 404, which ships an inline <style> our CSP blocks.
export default function NotFound() {
  return (
    <AuthShell title="Page not found" description="This page doesn't exist, or you don't have access to it.">
      <Link href="/" className="text-sm text-accent underline-offset-4 hover:underline">
        Go to your home page
      </Link>
    </AuthShell>
  );
}
