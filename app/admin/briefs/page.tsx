import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Badge, Button, Card, Input, PageHeader } from "@/components/ui";
import { requireAdmin } from "@/lib/auth/dal";
import { addMonths, isIsoMonth, localToday, monthLabel, monthOf } from "@/lib/domain/dates";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Monthly briefs" };

export default async function BriefsPage({ searchParams }: PageProps<"/admin/briefs">) {
  await requireAdmin();
  const { month } = await searchParams;
  if (typeof month === "string" && isIsoMonth(month)) redirect(`/admin/briefs/${month}`);

  const supabase = await createSupabaseServerClient();
  const { data: briefs } = await supabase
    .from("monthly_briefs")
    .select("month, title, updated_at, current:brief_versions!monthly_briefs_current_version_fk(version_no, content)")
    .order("month", { ascending: false });

  const thisMonth = monthOf(localToday("UTC"));
  const quick = [thisMonth, addMonths(thisMonth, 1)];

  return (
    <>
      <PageHeader
        title="Monthly briefs"
        description="One brief per month sets the theme and guidance for every founder's content. Each save creates a new version; earlier versions never change."
      />
      <Card className="mb-6">
        <form className="flex flex-wrap items-end gap-3" method="get">
          <label className="space-y-1.5">
            <span className="block text-sm font-medium">Open or start a month</span>
            <Input type="month" name="month" defaultValue={addMonths(thisMonth, 1)} required className="w-48" />
          </label>
          <Button type="submit">Open</Button>
          <span className="text-sm text-muted">
            or{" "}
            {quick.map((m, i) => (
              <span key={m}>
                {i > 0 ? " · " : null}
                <Link href={`/admin/briefs/${m}`} className="text-accent hover:underline">
                  {monthLabel(m)}
                </Link>
              </span>
            ))}
          </span>
        </form>
      </Card>

      <Card className="overflow-x-auto p-0">
        <table aria-label="Briefs" className="w-full text-left text-sm">
          <thead className="border-b border-border text-xs text-muted">
            <tr>
              <th className="px-4 py-2 font-medium">Month</th>
              <th className="px-4 py-2 font-medium">Theme</th>
              <th className="px-4 py-2 font-medium">Version</th>
            </tr>
          </thead>
          <tbody>
            {(briefs ?? []).map((brief) => {
              const m = brief.month.slice(0, 7);
              const theme = (brief.current?.content as { theme?: string } | undefined)?.theme ?? "";
              return (
                <tr key={brief.month} className="border-b border-border last:border-0">
                  <td className="px-4 py-3">
                    <Link href={`/admin/briefs/${m}`} className="font-medium hover:underline">
                      {monthLabel(m)}
                    </Link>
                  </td>
                  <td className="px-4 py-3">{brief.title || theme}</td>
                  <td className="px-4 py-3">
                    <Badge>v{brief.current?.version_no ?? 0}</Badge>
                  </td>
                </tr>
              );
            })}
            {briefs?.length ? null : (
              <tr>
                <td colSpan={3} className="px-4 py-6 text-center text-muted">
                  No briefs yet. Open a month above to write the first one.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </Card>
    </>
  );
}
