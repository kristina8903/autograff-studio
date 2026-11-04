import Link from "next/link";
import type { ReactNode } from "react";
import { NavMenu } from "./nav-menu";
import { SignOutButton } from "./sign-out-button";

export type NavItem = { href: string; label: string };
export type NavGroup = { label: string; items: NavItem[] };

/**
 * The signed-in page frame. `nav` is either a flat list of links (the founder
 * app, which has few pages) or groups shown as dropdowns (the admin app).
 */
export function AppShell({
  nav,
  email,
  children,
}: {
  nav: NavItem[] | NavGroup[];
  email: string;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-1 flex-col">
      <header className="border-b border-border bg-surface">
        <div className="mx-auto flex h-14 max-w-5xl items-center gap-6 px-4">
          <Link href="/" className="text-sm font-semibold tracking-tight whitespace-nowrap">
            Content Studio
          </Link>
          {isGrouped(nav) ? (
            <NavMenu groups={nav} />
          ) : (
            <nav aria-label="Main" className="flex min-w-0 gap-4 overflow-x-auto whitespace-nowrap text-sm">
              {nav.map((item) => (
                <Link key={item.href} href={item.href} className="text-muted hover:text-foreground">
                  {item.label}
                </Link>
              ))}
            </nav>
          )}
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

function isGrouped(nav: NavItem[] | NavGroup[]): nav is NavGroup[] {
  return nav.length > 0 && "items" in nav[0];
}
