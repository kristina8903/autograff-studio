import { AppShell } from "@/components/app-shell";
import { requireAdmin } from "@/lib/auth/dal";

// Grouped by stage of the workflow, so the header fits (it held 12 links, and
// the last three were cut off on a laptop screen).
const ADMIN_NAV = [
  {
    label: "Plan",
    items: [
      { href: "/admin/briefs", label: "Briefs" },
      { href: "/admin/calendar", label: "Calendar" },
      { href: "/admin/pipeline", label: "Pipeline" },
    ],
  },
  {
    label: "Create",
    items: [
      { href: "/admin/research", label: "Research" },
      { href: "/admin/concepts", label: "Concepts" },
      { href: "/admin/drafts", label: "Drafts" },
    ],
  },
  {
    label: "Publish",
    items: [
      { href: "/admin/publications", label: "Publications" },
      { href: "/admin/reports", label: "Reports" },
    ],
  },
  {
    label: "Setup",
    items: [
      { href: "/admin", label: "Founders & team" },
      { href: "/admin/voice", label: "Voice" },
      { href: "/admin/feedback", label: "Feedback" },
      { href: "/admin/ai", label: "AI usage" },
    ],
  },
];

// The layout check is for the chrome only: layouts do not re-run on every
// navigation, so each page and action calls requireAdmin() itself.
export default async function AdminLayout({ children }: LayoutProps<"/admin">) {
  const admin = await requireAdmin();
  return (
    <AppShell nav={ADMIN_NAV} email={admin.email}>
      {children}
    </AppShell>
  );
}
