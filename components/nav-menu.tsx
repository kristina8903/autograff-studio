"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useId, useRef, useState } from "react";
import { cx } from "./ui";
import type { NavGroup } from "./app-shell";

function isCurrent(pathname: string, href: string) {
  // "/admin" is the home page: only an exact match, or every admin page would claim it.
  return pathname === href || (href !== "/admin" && pathname.startsWith(`${href}/`));
}

/**
 * The admin menu, grouped. Each group is a disclosure button that opens a list
 * of links (not an ARIA menu: these are ordinary navigation links). It closes
 * on Escape, on a click outside and on navigation.
 */
export function NavMenu({ groups }: { groups: NavGroup[] }) {
  const pathname = usePathname();
  const [open, setOpen] = useState<string | null>(null);
  const ref = useRef<HTMLElement>(null);
  const baseId = useId();

  // Close when the page changes (a link was followed, or back/forward).
  const [lastPath, setLastPath] = useState(pathname);
  if (lastPath !== pathname) {
    setLastPath(pathname);
    setOpen(null);
  }

  useEffect(() => {
    if (!open) return;
    function onPointer(event: PointerEvent) {
      if (ref.current && !ref.current.contains(event.target as Node)) setOpen(null);
    }
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(null);
    }
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <nav ref={ref} aria-label="Main" className="flex min-w-0 gap-1 text-sm">
      {groups.map((group) => {
        const expanded = open === group.label;
        const active = group.items.some((item) => isCurrent(pathname, item.href));
        const listId = `${baseId}-${group.label}`;
        return (
          <div key={group.label} className="relative">
            <button
              type="button"
              aria-expanded={expanded}
              aria-controls={listId}
              onClick={() => setOpen(expanded ? null : group.label)}
              className={cx(
                "flex items-center gap-1 rounded-md px-2 py-1 hover:bg-background hover:text-foreground",
                active || expanded ? "text-foreground" : "text-muted",
                active && "font-medium",
              )}
            >
              {group.label}
              <svg aria-hidden="true" viewBox="0 0 12 12" className={cx("h-3 w-3", expanded && "rotate-180")}>
                <path d="M3 4.5 6 7.5 9 4.5" fill="none" stroke="currentColor" strokeWidth="1.5" />
              </svg>
            </button>
            {expanded ? (
              <ul
                id={listId}
                className="absolute left-0 top-full z-20 mt-1 min-w-44 rounded-md border border-border bg-surface py-1 shadow-md"
              >
                {group.items.map((item) => {
                  const current = isCurrent(pathname, item.href);
                  return (
                    <li key={item.href}>
                      <Link
                        href={item.href}
                        aria-current={current ? "page" : undefined}
                        onClick={() => setOpen(null)}
                        className={cx(
                          "block px-3 py-1.5 whitespace-nowrap hover:bg-background",
                          current ? "font-medium text-foreground" : "text-muted hover:text-foreground",
                        )}
                      >
                        {item.label}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            ) : null}
          </div>
        );
      })}
    </nav>
  );
}
