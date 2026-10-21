import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Badge, Card, PageHeader } from "@/components/ui";
import { requireAdmin } from "@/lib/auth/dal";
import { describeRule, monthTargets } from "@/lib/domain/cadence";
import { addMonths, localToday, monthLabel, monthOf } from "@/lib/domain/dates";
import { toCadenceRule } from "@/lib/server/planning";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { FounderForm, InviteForm } from "../../forms";
import { CadenceForm, type CadenceDefaults } from "./cadence-form";

export const metadata: Metadata = { title: "Founder" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function FounderPage({ params }: PageProps<"/admin/founders/[id]">) {
  await requireAdmin();
  const { id } = await params;
  if (!UUID.test(id)) notFound();

  const supabase = await createSupabaseServerClient();
  const [{ data: founder }, { data: settings }, { data: ruleRows }] = await Promise.all([
    supabase
      .from("founders")
      .select(
        "id, role_title, display_name, linkedin_profile_url, timezone, login:profiles!founders_user_id_fkey(email, status)",
      )
      .eq("id", id)
      .maybeSingle(),
    supabase.from("settings").select("allowed_email_domains").maybeSingle(),
    supabase.from("cadence_rules").select("*").eq("founder_id", id).order("effective_from", { ascending: false }),
  ]);
  if (!founder) notFound();

  const rows = ruleRows ?? [];
  const rules = rows.map(toCadenceRule);
  const latest = rows[0];
  const today = localToday(founder.timezone);
  const months = [monthOf(today), addMonths(monthOf(today), 1)];
  const defaults: CadenceDefaults = latest
    ? {
        period: latest.period,
        minPosts: latest.min_posts,
        maxPosts: latest.max_posts,
        weeklyPattern: latest.weekly_pattern,
        publishingDays: latest.publishing_days,
        reservedTimely: latest.reserved_timely_slots_per_month,
        bufferTarget: latest.buffer_target,
        lowBufferThreshold: latest.low_buffer_threshold,
        candidateMin: latest.candidate_target_min,
        candidateMax: latest.candidate_target_max,
      }
    : {
        period: "week",
        minPosts: 2,
        maxPosts: 3,
        weeklyPattern: null,
        publishingDays: [2, 3, 4],
        reservedTimely: 1,
        bufferTarget: 3,
        lowBufferThreshold: 2,
        candidateMin: 16,
        candidateMax: 20,
      };

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

      <Card className="mt-6">
        <h2 className="mb-1 font-semibold">Publishing cadence</h2>
        {latest ? (
          <div className="mb-5 space-y-3 text-sm">
            <p>
              <span className="font-medium">{describeRule(toCadenceRule(latest))}</span>
              {latest.reserved_timely_slots_per_month
                ? `, with ${latest.reserved_timely_slots_per_month} slot(s) a month kept for news`
                : ""}
              <span className="text-muted"> · since {latest.effective_from}</span>
            </p>
            <div className="flex flex-wrap gap-6" aria-label="Slots required">
              {months.map((m) => {
                const t = monthTargets(rules, m);
                return (
                  <p key={m}>
                    <span className="text-muted">{monthLabel(m)}:</span>{" "}
                    <span className="font-medium">{t.target} slots</span>
                    {t.min !== t.max ? (
                      <span className="text-muted">
                        {" "}
                        (range {t.min}–{t.max})
                      </span>
                    ) : null}
                  </p>
                );
              })}
            </div>
            {rows.length > 1 ? (
              <details>
                <summary className="cursor-pointer text-muted">Earlier cadences ({rows.length - 1})</summary>
                <ul className="mt-2 space-y-1">
                  {rows.slice(1).map((row) => (
                    <li key={row.id}>
                      {describeRule(toCadenceRule(row))}{" "}
                      <span className="text-muted">
                        · {row.effective_from} to {row.effective_to}
                        {row.change_reason ? ` · ${row.change_reason}` : ""}
                      </span>
                    </li>
                  ))}
                </ul>
              </details>
            ) : null}
          </div>
        ) : (
          <p className="mb-5 text-sm text-muted">No cadence yet. Choose a preset below to start.</p>
        )}
        <h3 className="mb-3 text-sm font-semibold">{latest ? "Change the cadence" : "Set the cadence"}</h3>
        <CadenceForm founderId={founder.id} today={today} defaults={defaults} />
      </Card>
    </>
  );
}
