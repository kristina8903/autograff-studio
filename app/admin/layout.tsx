import { AppShell } from "@/components/app-shell";
import { requireAdmin } from "@/lib/auth/dal";

// The layout check is for the chrome only: layouts do not re-run on every
// navigation, so each page and action calls requireAdmin() itself.
export default async function AdminLayout({ children }: LayoutProps<"/admin">) {
  const admin = await requireAdmin();
  return (
    <AppShell
      nav={[
        { href: "/admin", label: "Founders & team" },
        { href: "/admin/briefs", label: "Briefs" },
        { href: "/admin/calendar", label: "Calendar" },
        { href: "/admin/voice", label: "Voice" },
        { href: "/admin/feedback", label: "Feedback" },
      ]}
      email={admin.email}
    >
      {children}
    </AppShell>
  );
}
