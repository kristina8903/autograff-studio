import type { Metadata } from "next";
import Link from "next/link";
import { Badge, Card, PageHeader } from "@/components/ui";
import { requireAdmin } from "@/lib/auth/dal";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Voice" };

export default async function VoicePage() {
  await requireAdmin();
  const supabase = await createSupabaseServerClient();
  const [{ data: founders }, { data: profiles }, { data: examples }, { data: signals }] = await Promise.all([
    supabase.from("founders").select("id, display_name, role_title").eq("active", true).order("created_at"),
    supabase
      .from("voice_profiles")
      .select("founder_id, current:voice_profile_versions!voice_profiles_current_version_fk(version_no, created_at)"),
    supabase.from("writing_examples").select("founder_id, approved_for_voice, eval_holdout"),
    supabase.from("feedback_signals").select("founder_id").eq("status", "proposed"),
  ]);
  const profileOf = new Map((profiles ?? []).map((p) => [p.founder_id, p.current]));

  return (
    <>
      <PageHeader
        title="Founder voice"
        description="Each founder's voice profile and writing examples. The AI writes from the profile plus the approved examples that best match each post."
      />
      <Card className="overflow-x-auto p-0">
        <table aria-label="Voice" className="w-full text-left text-sm">
          <thead className="border-b border-border text-xs text-muted">
            <tr>
              <th className="px-4 py-2 font-medium">Founder</th>
              <th className="px-4 py-2 font-medium">Voice profile</th>
              <th className="px-4 py-2 font-medium">Approved examples</th>
              <th className="px-4 py-2 font-medium">Held out for evaluation</th>
              <th className="px-4 py-2 font-medium">Feedback to review</th>
            </tr>
          </thead>
          <tbody>
            {(founders ?? []).map((f) => {
              const current = profileOf.get(f.id);
              const own = (examples ?? []).filter((e) => e.founder_id === f.id);
              const pending = (signals ?? []).filter((s) => s.founder_id === f.id).length;
              return (
                <tr key={f.id} className="border-b border-border last:border-0">
                  <td className="px-4 py-3">
                    <Link href={`/admin/voice/${f.id}`} className="font-medium text-accent hover:underline">
                      {f.display_name}
                    </Link>{" "}
                    <span className="text-muted">({f.role_title})</span>
                  </td>
                  <td className="px-4 py-3">
                    {current ? (
                      <>
                        v{current.version_no}{" "}
                        <span className="text-xs text-muted">
                          {new Date(current.created_at).toLocaleDateString("en-US", { dateStyle: "medium" })}
                        </span>
                      </>
                    ) : (
                      <Badge>not written</Badge>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <Link href={`/admin/voice/${f.id}/examples`} className="hover:underline">
                      {own.filter((e) => e.approved_for_voice && !e.eval_holdout).length} of {own.length}
                    </Link>
                  </td>
                  <td className="px-4 py-3">{own.filter((e) => e.eval_holdout).length}</td>
                  <td className="px-4 py-3">
                    {pending ? (
                      <Link href={`/admin/feedback?founder=${f.id}`} className="hover:underline">
                        <Badge tone="accent">{pending}</Badge>
                      </Link>
                    ) : (
                      <span className="text-muted">0</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </Card>
    </>
  );
}
