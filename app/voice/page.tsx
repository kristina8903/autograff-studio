import type { Metadata } from "next";
import { AppShell } from "@/components/app-shell";
import { FOUNDER_NAV } from "@/components/founder-nav";
import { Badge, Card, PageHeader } from "@/components/ui";
import { ProfileView } from "@/components/voice-profile-view";
import { requireFounder } from "@/lib/auth/dal";
import { formatLabel } from "@/lib/domain/formats";
import { readVoiceVersion } from "@/lib/domain/voice";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { ShareExampleForm } from "./share-form";

export const metadata: Metadata = { title: "Your voice" };

export default async function FounderVoicePage() {
  const viewer = await requireFounder();
  const supabase = await createSupabaseServerClient();
  // Row-level security limits every query here to this founder's own rows.
  const [{ data: profile }, { data: examples }] = await Promise.all([
    supabase
      .from("voice_profiles")
      .select("current:voice_profile_versions!voice_profiles_current_version_fk(*)")
      .maybeSingle(),
    supabase
      .from("writing_examples")
      .select("id, body, published_at, format, approved_for_voice, created_at")
      .order("created_at", { ascending: false }),
  ]);
  const current = profile?.current ?? null;

  return (
    <AppShell nav={FOUNDER_NAV} email={viewer.email}>
      <PageHeader
        title="Your voice"
        description="How the studio describes your writing, and the examples it learns from. Only you and the admin can see this."
      />
      <div className="grid gap-6 lg:grid-cols-[1fr_20rem]">
        <Card>
          <h2 className="mb-3 font-semibold">
            Voice profile{" "}
            {current ? <span className="text-sm font-normal text-muted">v{current.version_no}</span> : null}
          </h2>
          {current ? (
            <>
              <ProfileView profile={readVoiceVersion(current)} />
              <p className="mt-4 text-xs text-muted">
                Something not right? Tell the admin; changes are saved as a new version.
              </p>
            </>
          ) : (
            <p className="text-sm text-muted">The admin hasn&apos;t written your voice profile yet.</p>
          )}
        </Card>
        <Card className="h-fit">
          <h2 className="mb-3 font-semibold">Share an example</h2>
          <ShareExampleForm />
        </Card>
      </div>

      <Card className="mt-6">
        <h2 className="mb-3 font-semibold">Your examples</h2>
        {examples?.length ? (
          <ul aria-label="Your examples" className="space-y-3 text-sm">
            {examples.map((example) => (
              <li key={example.id} className="rounded-md border border-border p-3">
                <p className="line-clamp-3 whitespace-pre-line">{example.body}</p>
                <p className="mt-1 flex items-center gap-2 text-xs text-muted">
                  {example.published_at ?? new Date(example.created_at).toLocaleDateString("en-US")} ·{" "}
                  {formatLabel(example.format)}
                  {example.approved_for_voice ? (
                    <Badge tone="success">used for your voice</Badge>
                  ) : (
                    <Badge>not used</Badge>
                  )}
                </p>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted">No examples yet.</p>
        )}
      </Card>
    </AppShell>
  );
}
