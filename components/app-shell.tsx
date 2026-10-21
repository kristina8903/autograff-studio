import Link from "next/link";
import type { ReactNode } from "react";
import { SignOutButton } from "./sign-out-button";

export function AppShell({
  nav,
  email,
  children,
}: {
  nav: { href: string; label: string }[];
  email: string;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-1 flex-col">
      <header className="border-b border-border bg-surface">
        <div className="mx-auto flex h-14 max-w-5xl items-center gap-6 px-4">
          <Link href="/" className="text-sm font-semibold tracking-tight">
            Content Studio
          </Link>
          <nav className="flex gap-4 text-sm">
            {nav.map((item) => (
              <Link key={item.href} href={item.href} className="text-muted hover:text-foreground">
                {item.label}
              </Link>
            ))}
          </nav>
          <div className="ml-auto flex items-center gap-4">
            <span className="hidden text-sm text-muted sm:inline">{email}</span>
            <SignOutButton />
          </div>
        </div>
      </header>
      <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-8">{children}</main>
    </div>
  );
}
