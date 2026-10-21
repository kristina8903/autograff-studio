import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Badge, Card, PageHeader } from "@/components/ui";
import { requireAdmin } from "@/lib/auth/dal";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { FounderForm, InviteForm } from "../../forms";

export const metadata: Metadata = { title: "Founder" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function FounderPage({ params }: PageProps<"/admin/founders/[id]">) {
  await requireAdmin();
  const { id } = await params;
  if (!UUID.test(id)) notFound();

  const supabase = await createSupabaseServerClient();
  const [{ data: founder }, { data: settings }] = await Promise.all([
    supabase
      .from("founders")
      .select(
        "id, role_title, display_name, linkedin_profile_url, timezone, login:profiles!founders_user_id_fkey(email, status)",
      )
      .eq("id", id)
      .maybeSingle(),
    supabase.from("settings").select("allowed_email_domains").maybeSingle(),
  ]);
  if (!founder) notFound();

  return (
    <>
      <PageHeader title={founder.display_name} description={founder.role_title} />
      <div className="grid gap-6 lg:grid-cols-[2fr_1fr]">
        <Card>
          <h2 className="mb-4 font-semibold">Profile</h2>
          <FounderForm founder={founder} allTimeZones={Intl.supportedValuesOf("timeZone")} />
        </Card>
        <Card>
          <h2 className="mb-4 font-semibold">Login</h2>
          {founder.login ? (
            <div className="space-y-2 text-sm">
              <p>{founder.login.email}</p>
              <Badge
                tone={
                  founder.login.status === "active"
                    ? "success"
                    : founder.login.status === "invited"
                      ? "accent"
                      : "danger"
                }
              >
                {founder.login.status}
              </Badge>
              {founder.login.status === "invited" ? (
                <p className="text-muted">
                  Invitation sent. It expires one hour after sending; they become active when they first sign in.
                </p>
              ) : null}
            </div>
          ) : (
            <InviteForm founderId={founder.id} domains={settings?.allowed_email_domains ?? []} />
          )}
        </Card>
      </div>
    </>
  );
}
