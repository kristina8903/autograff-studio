import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Alert, Badge, Card, PageHeader, cx } from "@/components/ui";
import { requireAdmin } from "@/lib/auth/dal";
import { ProfileView } from "@/components/voice-profile-view";
import { EMPTY_PROFILE, diffProfiles, readVoiceVersion, type VoiceProfile } from "@/lib/domain/voice";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { VoiceForm } from "./voice-form";

export const metadata: Metadata = { title: "Voice profile" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function VoiceProfilePage({ params, searchParams }: PageProps<"/admin/voice/[founderId]">) {
  await requireAdmin();
  const { founderId } = await params;
  if (!UUID.test(founderId)) notFound();
  const { v, saved, signal } = await searchParams;

  const supabase = await createSupabaseServerClient();
  const [{ data: founder }, { data: profile }, { data: versions }] = await Promise.all([
    supabase.from("founders").select("id, display_name, role_title").eq("id", founderId).maybeSingle(),
    supabase.from("voice_profiles").select("current_version_id").eq("founder_id", founderId).maybeSingle(),
    supabase
      .from("voice_profile_versions")
      .select("*, author:profiles(email)")
      .eq("founder_id", founderId)
      .order("version_no", { ascending: false }),
  ]);
  if (!founder) notFound();
  const signalIds = (Array.isArray(signal) ? signal : signal ? [signal] : []).filter((id) => UUID.test(id));
  const { data: signals } = signalIds.length
    ? await supabase
        .from("feedback_signals")
        .select("id, statement, kind")
        .in("id", signalIds)
        .eq("founder_id", founderId)
        .eq("status", "proposed")
        .in("kind", ["stable_preference", "format_preference"])
    : { data: [] };

  const current = versions?.find((version) => version.id === profile?.current_version_id) ?? null;
  const viewing = typeof v === "string" ? versions?.find((version) => String(version.version_no) === v) : undefined;
  const previous = viewing ? versions?.find((version) => version.version_no === viewing.version_no - 1) : undefined;

  return (
    <>
      <PageHeader
        title={`${founder.display_name}: voice profile`}
        description={
          current
            ? `Current version: v${current.version_no}. Saving creates v${current.version_no + 1}; earlier versions never change.`
            : "No voice profile yet. Saving creates version 1."
        }
        actions={
          <div className="flex gap-4 text-sm">
            <Link href={`/admin/voice/${founderId}/examples`} className="text-accent hover:underline">
              Writing examples
            </Link>
            <Link href="/admin/voice" className="text-muted hover:text-foreground">
              ← All founders
            </Link>
          </div>
        }
      />
      {saved ? (
        <div className="mb-4">
          <Alert tone="success">Saved as version {String(saved)}.</Alert>
        </div>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-[1fr_16rem]">
        <Card>
          {viewing ? (
            <VersionView
              profile={readVoiceVersion(viewing)}
              previous={previous ? readVoiceVersion(previous) : null}
              versionNo={viewing.version_no}
              founderId={founderId}
              isCurrent={viewing.id === current?.id}
            />
          ) : (
            <VoiceForm
              founderId={founderId}
              profile={current ? readVoiceVersion(current) : EMPTY_PROFILE}
              nextVersion={(current?.version_no ?? 0) + 1}
              signals={signals ?? []}
            />
          )}
        </Card>

        <Card className="h-fit">
          <h2 className="mb-3 text-sm font-semibold">Version history</h2>
          {versions?.length ? (
            <ol className="space-y-2 text-sm">
              {versions.map((version) => (
                <li key={version.id}>
                  <Link
                    href={`/admin/voice/${founderId}?v=${version.version_no}`}
                    className={cx(
                      "block rounded px-2 py-1 hover:bg-background",
                      viewing?.id === version.id && "bg-background",
                    )}
                  >
                    <span className="font-medium">v{version.version_no}</span>{" "}
                    {version.id === current?.id ? <Badge tone="accent">current</Badge> : null}
                    {version.source_feedback_ids.length ? <Badge>from feedback</Badge> : null}
                    <span className="block text-xs text-muted">
                      {new Date(version.created_at).toLocaleString("en-US", {
                        dateStyle: "medium",
                        timeStyle: "short",
                      })}
                      {version.author?.email ? ` · ${version.author.email}` : ""}
                    </span>
                    <span className="block text-xs">{version.change_reason}</span>
                  </Link>
                </li>
              ))}
            </ol>
          ) : (
            <p className="text-sm text-muted">No versions yet.</p>
          )}
          {viewing ? (
            <Link href={`/admin/voice/${founderId}`} className="mt-4 block text-sm text-accent hover:underline">
              Edit the current version
            </Link>
          ) : null}
        </Card>
      </div>
    </>
  );
}

function VersionView({
  profile,
  previous,
  versionNo,
  founderId,
  isCurrent,
}: {
  profile: VoiceProfile;
  previous: VoiceProfile | null;
  versionNo: number;
  founderId: string;
  isCurrent: boolean;
}) {
  const changes = previous ? diffProfiles(previous, profile) : [];
  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2">
        <h2 className="font-semibold">Version {versionNo}</h2>
        {isCurrent ? <Badge tone="accent">current</Badge> : <Badge>read-only</Badge>}
      </div>
      {previous ? (
        <section aria-label="Changes from the previous version" className="rounded-md border border-border p-4">
          <h3 className="mb-2 text-sm font-semibold">Changes from v{versionNo - 1}</h3>
          {changes.length ? (
            <ul className="space-y-3 text-sm">
              {changes.map((change) => (
                <li key={change.field}>
                  <p className="font-medium">{change.field}</p>
                  {change.before.length ? (
                    <p className="text-danger line-through">{change.before.join(" · ")}</p>
                  ) : null}
                  {change.after.length ? <p className="text-success">{change.after.join(" · ")}</p> : null}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted">No content changes.</p>
          )}
        </section>
      ) : null}
      <ProfileView profile={profile} />
      <Link href={`/admin/voice/${founderId}`} className="text-sm text-accent hover:underline">
        {isCurrent ? "Edit (saves a new version)" : "Back to the current version"}
      </Link>
    </div>
  );
}
