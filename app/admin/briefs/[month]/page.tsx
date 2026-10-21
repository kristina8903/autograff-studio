import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Alert, Badge, Card, PageHeader, cx } from "@/components/ui";
import { requireAdmin } from "@/lib/auth/dal";
import { LIST_FIELDS, diffBriefs, readSnapshot, type BriefSnapshot } from "@/lib/domain/briefs";
import { isIsoMonth, monthLabel } from "@/lib/domain/dates";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { BriefForm } from "../brief-form";

export const metadata: Metadata = { title: "Brief" };

export default async function BriefMonthPage({ params, searchParams }: PageProps<"/admin/briefs/[month]">) {
  await requireAdmin();
  const { month } = await params;
  if (!isIsoMonth(month)) notFound();
  const { v, saved } = await searchParams;

  const supabase = await createSupabaseServerClient();
  const [{ data: brief }, { data: founderRows }] = await Promise.all([
    supabase.from("monthly_briefs").select("id, title, current_version_id").eq("month", `${month}-01`).maybeSingle(),
    supabase.from("founders").select("id, display_name, role_title").eq("active", true).order("created_at"),
  ]);
  const { data: versions } = brief
    ? await supabase
        .from("brief_versions")
        .select(
          "id, version_no, content, founder_emphasis, approved_facts, change_note, created_at, author:profiles(email)",
        )
        .eq("brief_id", brief.id)
        .order("version_no", { ascending: false })
    : { data: [] };

  const founders = (founderRows ?? []).map((f) => ({ id: f.id, label: `${f.display_name} (${f.role_title})` }));
  const founderNames = Object.fromEntries(founders.map((f) => [f.id, f.label]));
  const current = versions?.find((version) => version.id === brief?.current_version_id) ?? null;
  const viewing = typeof v === "string" ? versions?.find((version) => String(version.version_no) === v) : undefined;
  const previous = viewing ? versions?.find((version) => version.version_no === viewing.version_no - 1) : undefined;

  return (
    <>
      <PageHeader
        title={`${monthLabel(month)} brief`}
        description={
          current
            ? `Current version: v${current.version_no}. Saving creates v${current.version_no + 1}; earlier versions never change.`
            : "No brief for this month yet. Saving creates version 1."
        }
        actions={
          <Link href="/admin/briefs" className="text-sm text-muted hover:text-foreground">
            ← All briefs
          </Link>
        }
      />
      {saved ? (
        <div className="mb-4">
          <Alert tone="success">Saved as version {current?.version_no}.</Alert>
        </div>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-[1fr_16rem]">
        <Card>
          {viewing ? (
            <VersionView
              snapshot={readSnapshot(viewing)}
              previous={previous ? readSnapshot(previous) : null}
              versionNo={viewing.version_no}
              founderNames={founderNames}
              month={month}
              isCurrent={viewing.id === current?.id}
            />
          ) : (
            <BriefForm
              month={month}
              title={brief?.title ?? ""}
              snapshot={current ? readSnapshot(current) : null}
              founders={founders}
              nextVersion={(current?.version_no ?? 0) + 1}
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
                    href={`/admin/briefs/${month}?v=${version.version_no}`}
                    className={cx(
                      "block rounded px-2 py-1 hover:bg-background",
                      viewing?.id === version.id && "bg-background",
                    )}
                  >
                    <span className="font-medium">v{version.version_no}</span>{" "}
                    {version.id === current?.id ? <Badge tone="accent">current</Badge> : null}
                    <span className="block text-xs text-muted">
                      {new Date(version.created_at).toLocaleString("en-US", {
                        dateStyle: "medium",
                        timeStyle: "short",
                      })}
                      {version.author?.email ? ` · ${version.author.email}` : ""}
                    </span>
                    {version.change_note ? <span className="block text-xs">{version.change_note}</span> : null}
                  </Link>
                </li>
              ))}
            </ol>
          ) : (
            <p className="text-sm text-muted">No versions yet.</p>
          )}
          {viewing ? (
            <Link href={`/admin/briefs/${month}`} className="mt-4 block text-sm text-accent hover:underline">
              Edit the current version
            </Link>
          ) : null}
        </Card>
      </div>
    </>
  );
}

function VersionView({
  snapshot,
  previous,
  versionNo,
  founderNames,
  month,
  isCurrent,
}: {
  snapshot: BriefSnapshot;
  previous: BriefSnapshot | null;
  versionNo: number;
  founderNames: Record<string, string>;
  month: string;
  isCurrent: boolean;
}) {
  const changes = previous ? diffBriefs(previous, snapshot, founderNames) : [];
  const rows: [string, string[]][] = [
    ["Theme", [snapshot.content.theme]],
    ...LIST_FIELDS.map(([key, label]) => [label, snapshot.content[key]] as [string, string[]]),
    ...Object.entries(snapshot.founderEmphasis).map(
      ([id, text]) => [`Emphasis: ${founderNames[id] ?? "Former founder"}`, [text]] as [string, string[]],
    ),
    ["Approved facts and messaging", snapshot.approvedFacts],
  ];
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
      <dl className="space-y-4 text-sm">
        {rows
          .filter(([, values]) => values.length)
          .map(([label, values]) => (
            <div key={label}>
              <dt className="text-muted">{label}</dt>
              <dd>
                {values.length === 1 ? (
                  values[0]
                ) : (
                  <ul className="list-disc pl-5">
                    {values.map((value) => (
                      <li key={value}>{value}</li>
                    ))}
                  </ul>
                )}
              </dd>
            </div>
          ))}
      </dl>
      <Link href={`/admin/briefs/${month}`} className="text-sm text-accent hover:underline">
        {isCurrent ? "Edit (saves a new version)" : "Back to the current version"}
      </Link>
    </div>
  );
}
