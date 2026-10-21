import type { Metadata } from "next";
import Link from "next/link";
import { Badge, ButtonLink, Card, PageHeader } from "@/components/ui";
import { requireAdmin } from "@/lib/auth/dal";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { DeactivateButton } from "./forms";

export const metadata: Metadata = { title: "Founders & team" };

const statusTone = { active: "success", invited: "accent", deactivated: "danger" } as const;

export default async function AdminHome() {
  const admin = await requireAdmin();
  const supabase = await createSupabaseServerClient();
  const [{ data: founders }, { data: team }] = await Promise.all([
    supabase
      .from("founders")
      .select("id, role_title, display_name, timezone, active, login:profiles!founders_user_id_fkey(email, status)")
      .order("created_at"),
    supabase.from("profiles").select("user_id, email, display_name, role, status").order("created_at"),
  ]);

  return (
    <>
      <PageHeader
        title="Founders"
        description="Each founder has their own profile, cadence and drafts. Founders see only their own content."
        actions={<ButtonLink href="/admin/founders/new">Add founder</ButtonLink>}
      />
      <Card className="overflow-x-auto p-0">
        <table aria-label="Founders" className="w-full text-left text-sm">
          <thead className="border-b border-border text-xs text-muted">
            <tr>
              <th className="px-4 py-2 font-medium">Name</th>
              <th className="px-4 py-2 font-medium">Role</th>
              <th className="px-4 py-2 font-medium">Time zone</th>
              <th className="px-4 py-2 font-medium">Login</th>
            </tr>
          </thead>
          <tbody>
            {(founders ?? []).map((founder) => (
              <tr key={founder.id} className="border-b border-border last:border-0">
                <td className="px-4 py-3">
                  <Link href={`/admin/founders/${founder.id}`} className="font-medium hover:underline">
                    {founder.display_name}
                  </Link>
                </td>
                <td className="px-4 py-3">{founder.role_title}</td>
                <td className="px-4 py-3 text-muted">{founder.timezone.replaceAll("_", " ")}</td>
                <td className="px-4 py-3">
                  {founder.login ? (
                    <span className="flex items-center gap-2">
                      <span className="text-muted">{founder.login.email}</span>
                      <Badge tone={statusTone[founder.login.status]}>{founder.login.status}</Badge>
                    </span>
                  ) : (
                    <Link href={`/admin/founders/${founder.id}`} className="text-accent hover:underline">
                      Invite
                    </Link>
                  )}
                </td>
              </tr>
            ))}
            {founders?.length ? null : (
              <tr>
                <td colSpan={4} className="px-4 py-6 text-center text-muted">
                  No founders yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </Card>

      <h2 className="mt-10 mb-3 text-lg font-semibold">Team</h2>
      <Card className="overflow-x-auto p-0">
        <table aria-label="Team" className="w-full text-left text-sm">
          <thead className="border-b border-border text-xs text-muted">
            <tr>
              <th className="px-4 py-2 font-medium">Email</th>
              <th className="px-4 py-2 font-medium">Role</th>
              <th className="px-4 py-2 font-medium">Status</th>
              <th className="px-4 py-2" />
            </tr>
          </thead>
          <tbody>
            {(team ?? []).map((member) => (
              <tr key={member.user_id} className="border-b border-border last:border-0">
                <td className="px-4 py-3">{member.email}</td>
                <td className="px-4 py-3 capitalize">{member.role}</td>
                <td className="px-4 py-3">
                  <Badge tone={statusTone[member.status]}>{member.status}</Badge>
                </td>
                <td className="px-4 py-3 text-right">
                  {member.user_id !== admin.userId && member.status !== "deactivated" ? (
                    <DeactivateButton userId={member.user_id} label={member.email} />
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </>
  );
}
