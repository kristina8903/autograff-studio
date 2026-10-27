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
        { href: "/admin/pipeline", label: "Pipeline" },
        { href: "/admin/research", label: "Research" },
        { href: "/admin/concepts", label: "Concepts" },
        { href: "/admin/drafts", label: "Drafts" },
        { href: "/admin/publications", label: "Publications" },
        { href: "/admin/reports", label: "Reports" },
        { href: "/admin/voice", label: "Voice" },
        { href: "/admin/feedback", label: "Feedback" },
        { href: "/admin/ai", label: "AI usage" },
      ]}
      email={admin.email}
    >
      {children}
    </AppShell>
  );
}
