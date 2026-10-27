import Link from "next/link";
import { cx } from "@/components/ui";

export function PipelineTabs({ current, month }: { current: "coverage" | "diversity"; month: string }) {
  const tab = (href: string, label: string, active: boolean) => (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={cx(
        "rounded-full border px-3 py-1",
        active ? "border-accent bg-accent/10 text-accent" : "border-border text-muted hover:text-foreground",
      )}
    >
      {label}
    </Link>
  );
  return (
    <nav aria-label="Pipeline views" className="mb-6 flex gap-2 text-sm">
      {tab(`/admin/pipeline?month=${month}`, "Coverage", current === "coverage")}
      {tab(`/admin/pipeline/diversity?month=${month}`, "Diversity", current === "diversity")}
    </nav>
  );
}
