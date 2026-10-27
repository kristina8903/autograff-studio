import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge, Card, PageHeader, cx } from "@/components/ui";
import { requireAdmin } from "@/lib/auth/dal";
import { SHORT_HORIZON_DAYS, type CoverageStatus } from "@/lib/domain/coverage";
import { addMonths, isIsoMonth, localToday, monthLabel, monthOf, shortDateLabel } from "@/lib/domain/dates";
import { loadPipeline, periodMonths, type FounderPipeline } from "@/lib/server/pipeline";
import { ReplenishForm } from "./pipeline-forms";
import { PipelineTabs } from "./pipeline-tabs";

export const metadata: Metadata = { title: "Pipeline" };

const STATUS: Record<CoverageStatus, { label: string; tone: "success" | "accent" | "danger" }> = {
  covered: { label: "Covered", tone: "success" },
  at_risk: { label: "At risk", tone: "accent" },
  short: { label: "Short", tone: "danger" },
};

export default async function PipelinePage({ searchParams }: PageProps<"/admin/pipeline">) {
  await requireAdmin();
  const params = await searchParams;
  const month = typeof params.month === "string" ? params.month : monthOf(localToday("UTC"));
  const span = typeof params.span === "string" ? Number(params.span) : 2;
  if (!isIsoMonth(month) || ![1, 2, 3].includes(span)) notFound();
  const period = { first: month, months: span };
  const months = periodMonths(period);
  const pipelines = await loadPipeline(period);
  const periodName =
    months.length === 1 ? monthLabel(months[0]) : `${monthLabel(months[0])} – ${monthLabel(months.at(-1)!)}`;
  const href = (m: string, s: number) => `/admin/pipeline?month=${m}${s === 2 ? "" : `&span=${s}`}`;

  return (
    <>
      <PageHeader
        title="Pipeline"
        description="Whether each founder has enough approved content for their cadence. Only approved posts count as supply; drafts in review are pipeline. Nothing here approves, schedules or publishes."
        actions={
          <div className="flex items-center gap-3 text-sm">
            <Link
              href={href(addMonths(month, -1), span)}
              className="text-muted hover:text-foreground"
              aria-label="Earlier"
            >
              ←
            </Link>
            <span className="font-medium">{periodName}</span>
            <Link
              href={href(addMonths(month, 1), span)}
              className="text-muted hover:text-foreground"
              aria-label="Later"
            >
              →
            </Link>
          </div>
        }
      />
      <div className="flex flex-wrap items-start justify-between gap-4">
        <PipelineTabs current="coverage" month={month} />
        <nav aria-label="Period length" className="flex gap-2 text-sm">
          {[1, 2, 3].map((s) => (
            <Link
              key={s}
              href={href(month, s)}
              aria-current={s === span ? "page" : undefined}
              className={cx(
                "rounded-full border px-3 py-1",
                s === span
                  ? "border-accent bg-accent/10 text-accent"
                  : "border-border text-muted hover:text-foreground",
              )}
            >
              {s} month{s === 1 ? "" : "s"}
            </Link>
          ))}
        </nav>
      </div>

      <Card className="mb-8 overflow-x-auto p-0">
        <table aria-label="Coverage" className="w-full text-left text-sm">
          <thead className="border-b border-border text-xs text-muted">
            <tr>
              <th className="px-4 py-2 font-medium">Founder</th>
              <th className="px-4 py-2 font-medium">Status</th>
              <th className="px-4 py-2 font-medium">Slots required</th>
              <th className="px-4 py-2 font-medium">Published</th>
              <th className="px-4 py-2 font-medium">Scheduled</th>
              <th className="px-4 py-2 font-medium">Approved, unscheduled</th>
              <th className="px-4 py-2 font-medium">Supply gap</th>
              <th className="px-4 py-2 font-medium">Next open slot</th>
            </tr>
          </thead>
          <tbody>
            {pipelines.map((p) => (
              <tr key={p.founder.id} className="border-b border-border last:border-0">
                <td className="px-4 py-3">
                  <a href={`#founder-${p.founder.id}`} className="font-medium hover:underline">
                    {p.founder.displayName}
                  </a>{" "}
                  <span className="text-muted">({p.founder.roleTitle})</span>
                </td>
                <td className="px-4 py-3">
                  <span className="flex flex-wrap gap-1">
                    <Badge tone={STATUS[p.status].tone}>{STATUS[p.status].label}</Badge>
                    {p.shortfall ? <Badge tone="danger">Buffer low</Badge> : null}
                  </span>
                </td>
                <td className="px-4 py-3">
                  {p.coverage.required}
                  {unplanned(p) ? <span className="block text-xs text-danger">not planned</span> : null}
                </td>
                <td className="px-4 py-3">{p.coverage.published}</td>
                <td className="px-4 py-3">{p.coverage.scheduled}</td>
                <td className="px-4 py-3">{p.coverage.usableBuffer}</td>
                <td className="px-4 py-3">{p.coverage.supplyGap}</td>
                <td className="px-4 py-3">{p.nextOpenSlot ? shortDateLabel(p.nextOpenSlot) : "—"}</td>
              </tr>
            ))}
            {pipelines.length ? null : (
              <tr>
                <td colSpan={8} className="px-4 py-6 text-center text-muted">
                  No active founders.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </Card>

      <div className="space-y-6">
        {pipelines.map((p) => (
          <FounderCard key={p.founder.id} p={p} periodName={periodName} month={month} />
        ))}
      </div>
    </>
  );
}

/** The cadence asks for posts in the period, but no slots are planned yet. */
function unplanned(p: FounderPipeline): boolean {
  return p.hasCadence && p.coverage.required === 0 && p.coverage.skipped === 0 && p.coverage.targets.target > 0;
}

function Row({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-border py-1.5 last:border-0">
      <dt>
        {label}
        {hint ? <span className="block text-xs text-muted">{hint}</span> : null}
      </dt>
      <dd className="font-medium tabular-nums">{children}</dd>
    </div>
  );
}

function FounderCard({ p, periodName, month }: { p: FounderPipeline; periodName: string; month: string }) {
  const c = p.coverage;
  const r = p.replenishment;
  return (
    <Card id={`founder-${p.founder.id}`} aria-label={`Pipeline for ${p.founder.displayName}`}>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg font-semibold">
          {p.founder.displayName} <span className="text-sm font-normal text-muted">({p.founder.roleTitle})</span>
        </h2>
        <span className="flex flex-wrap gap-1">
          <Badge tone={STATUS[p.status].tone}>{STATUS[p.status].label}</Badge>
          {p.shortfall ? <Badge tone="danger">Buffer low</Badge> : null}
        </span>
      </div>
      {!p.hasCadence ? (
        <p className="mb-4 text-sm">
          No cadence yet.{" "}
          <Link href={`/admin/founders/${p.founder.id}`} className="text-accent hover:underline">
            Set a cadence
          </Link>{" "}
          to plan slots.
        </p>
      ) : null}
      {unplanned(p) ? (
        <p className="mb-4 text-sm text-danger">
          No slots are planned for {periodName}, so nothing counts as required yet.{" "}
          <Link href={`/admin/calendar?month=${month}`} className="text-accent hover:underline">
            Plan slots on the calendar
          </Link>
          .
        </p>
      ) : null}
      {p.shortfall ? (
        <p className="mb-4 text-sm text-danger" role="status">
          {c.usableBuffer} approved post{c.usableBuffer === 1 ? "" : "s"} in hand, below the threshold of{" "}
          {p.lowBufferThreshold}.
        </p>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-3">
        <section aria-label="Supply">
          <h3 className="mb-2 text-sm font-semibold">{periodName}</h3>
          <dl className="text-sm">
            <Row label="Slots required" hint={`Cadence range ${c.targets.min}–${c.targets.max}`}>
              {c.required}
            </Row>
            <Row label="Published">{c.published}</Row>
            <Row label="Scheduled">{c.scheduled}</Row>
            <Row label="Remaining slots">{c.remainingSlots}</Row>
            <Row label="Usable buffer" hint={`Approved, not scheduled · target ${p.bufferTarget}`}>
              {c.usableBuffer}
            </Row>
            <Row label="Supply gap">{c.supplyGap}</Row>
            <Row label="Next open slot" hint={`Short when a gap meets a slot within ${SHORT_HORIZON_DAYS} days`}>
              {p.nextOpenSlot ? shortDateLabel(p.nextOpenSlot) : "None"}
            </Row>
          </dl>
        </section>

        <section aria-label="Pipeline">
          <h3 className="mb-2 text-sm font-semibold">In the pipeline (not supply)</h3>
          <dl className="text-sm">
            <Row label="Awaiting founder review">{c.inFounderReview}</Row>
            <Row label="Awaiting admin review" hint="Drafting, in review, or changes requested">
              {c.inAdminReview}
            </Row>
            <Row label="Concepts awaiting drafting">{c.conceptsWaiting}</Row>
          </dl>
          <h3 className="mt-4 mb-2 text-sm font-semibold">Never counted</h3>
          <dl className="text-sm">
            <Row label="Repeats published content" hint="Approved, with an open repetition warning">
              {p.apart.heldRepeat}
            </Row>
            <Row label="Scheduled outside this period">{p.apart.scheduledOtherPeriod}</Row>
            <Row label="Approval no longer valid">{p.apart.approvalInvalid}</Row>
            <Row label="Rejected or archived">{p.apart.excluded}</Row>
            <Row label="External">{p.apart.external}</Row>
          </dl>
        </section>

        <section aria-label="Replenishment">
          <h3 className="mb-2 text-sm font-semibold">Replenish {monthLabel(p.targetMonth)}</h3>
          <dl className="mb-3 text-sm">
            <Row label="Candidate ceiling" hint="From the cadence">
              {p.candidateTargetMax}
            </Row>
            <Row label="Unused concepts and drafts in progress">{r.candidatesExisting}</Row>
            <Row label="Need">{r.need}</Row>
          </dl>
          {r.batch > 0 ? (
            <ReplenishForm
              founderId={p.founder.id}
              founderName={p.founder.displayName}
              month={p.targetMonth}
              monthName={monthLabel(p.targetMonth)}
              batch={r.batch}
              nonce={crypto.randomUUID()}
            />
          ) : p.targetPast ? (
            <p className="text-sm text-muted">{monthLabel(p.targetMonth)} has passed. Nothing to generate.</p>
          ) : (
            <p className="text-sm text-muted">
              Supply is sufficient for {monthLabel(p.targetMonth)}. Nothing to generate.
            </p>
          )}
          {c.conceptsWaiting > 0 ? (
            <p className="mt-3 text-sm">
              <Link href={`/admin/concepts?month=${p.targetMonth}`} className="text-accent hover:underline">
                Draft the {c.conceptsWaiting} selected concept{c.conceptsWaiting === 1 ? "" : "s"}
              </Link>
            </p>
          ) : null}
        </section>
      </div>
    </Card>
  );
}
