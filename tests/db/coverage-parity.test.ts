// Checks that SQL and TypeScript coverage agree on the same rows: slot counts
// (public.coverage_slot_counts vs countSlots, Phase 2) and the draft buckets
// (public.coverage_draft_buckets and public.coverage vs bucketOf, Phase 8).
// Runs against the LOCAL Supabase stack only (npm run test:db).
import { createClient } from "@supabase/supabase-js";
import { afterAll, describe, expect, it } from "vitest";
import {
  BUCKETS,
  bucketOf,
  countBuckets,
  countSlots,
  type DraftStatus,
  type Period,
  type SlotRow,
} from "@/lib/domain/coverage";
import type { Database } from "@/lib/supabase/database.types";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
if (!/^http:\/\/(127\.0\.0\.1|localhost):/.test(url))
  throw new Error("coverage-parity runs only against the local stack");
const db = createClient<Database>(url, process.env.SUPABASE_SECRET_KEY ?? "", { auth: { persistSession: false } });

const COMPANY = "00000000-0000-4000-8000-000000000001";
const COO = "00000000-0000-4000-8000-0000000000f3";
const MONTH = "2031-03-01";

const fixtures: { day: number; kind: SlotRow["kind"]; status: SlotRow["status"] }[] = [
  { day: 3, kind: "regular", status: "open" },
  { day: 4, kind: "reserved_timely", status: "open" },
  { day: 5, kind: "regular", status: "skipped" },
  { day: 10, kind: "reserved_timely", status: "skipped" },
  { day: 11, kind: "regular", status: "filled" },
  { day: 12, kind: "manual", status: "open" },
  { day: 31, kind: "manual", status: "filled" },
];

const draftIds: string[] = [];

afterAll(async () => {
  await db.from("calendar_slots").delete().eq("founder_id", COO).gte("slot_date", MONTH);
  if (draftIds.length) await db.from("drafts").delete().in("id", draftIds);
});

describe("coverage parity", () => {
  it("SQL and TypeScript slot counts agree", async () => {
    const { data: rule } = await db.from("cadence_rules").select("id").eq("founder_id", COO).single();
    // A filled slot holds a real draft (bare rows; their content doesn't matter here).
    const filled = fixtures.filter((f) => f.status === "filled");
    const { data: drafts, error: draftError } = await db
      .from("drafts")
      .insert(
        filled.map(() => ({
          company_id: COMPANY,
          founder_id: COO,
          target_month: MONTH,
          brief_version_id: "00000000-0000-4000-8000-0000000000b1",
        })),
      )
      .select("id");
    expect(draftError).toBeNull();
    draftIds.push(...drafts!.map((d) => d.id));
    const rows = fixtures.map((f) => ({
      company_id: COMPANY,
      founder_id: COO,
      slot_date: `2031-03-${String(f.day).padStart(2, "0")}`,
      kind: f.kind,
      status: f.status,
      cadence_rule_id: f.kind === "manual" ? null : rule!.id,
      draft_id: f.status === "filled" ? draftIds[filled.indexOf(f)] : null,
    }));
    const inserted = await db.from("calendar_slots").insert(rows);
    expect(inserted.error).toBeNull();
    // A slot in the next month must not be counted.
    await db
      .from("calendar_slots")
      .insert({ company_id: COMPANY, founder_id: COO, slot_date: "2031-04-01", kind: "manual" });

    const { data: stored } = await db
      .from("calendar_slots")
      .select("kind, status")
      .eq("founder_id", COO)
      .gte("slot_date", MONTH)
      .lt("slot_date", "2031-04-01");
    const ts = countSlots(stored!);
    const { data: sql, error } = await db.rpc("coverage_slot_counts", { p_founder_id: COO, p_month: MONTH }).single();
    expect(error).toBeNull();
    expect(sql).toEqual({
      required: ts.required,
      reserved_timely: ts.reservedTimely,
      open: ts.open,
      filled: ts.filled,
      skipped: ts.skipped,
    });
    expect(ts).toEqual({ required: 5, reservedTimely: 1, open: 3, filled: 2, skipped: 2 });
  });
});

// Drafts for the CTO (whose login can approve), written directly with
// the service role. Approvals can never be deleted, so these rows stay until
// the next reset (npm run test:db resets first).
const CTO = "00000000-0000-4000-8000-0000000000f2";
const CTO_USER = "00000000-0000-4000-8000-0000000000c2";
const PERIOD: Period = { from: "2032-02-01", to: "2032-04-01" };
const STATUSES: DraftStatus[] = [
  "drafting",
  "admin_review",
  "founder_review",
  "changes_requested",
  "approved",
  "scheduled",
  "published",
  "rejected",
  "archived",
];

describe("coverage bucket parity", () => {
  it("SQL and TypeScript put every draft in the same single bucket", async () => {
    // Every combination of status, external, approval and repetition warning,
    // with scheduled dates either side of both period edges.
    const DATES = ["2032-01-31", "2032-02-01", "2032-03-31", "2032-04-01"];
    const planned = STATUSES.flatMap((status) =>
      [false, true].flatMap((isExternal) =>
        [false, true].flatMap((approve) => [false, true].map((repeats) => ({ status, isExternal, approve, repeats }))),
      ),
    ).map((p, i) => ({
      ...p,
      // Los Angeles noon, so the local date is the one written.
      scheduledFor:
        p.status === "scheduled" || p.status === "published" ? `${DATES[i % DATES.length]}T12:00:00-08:00` : null,
      body: `Parity post ${i}.`,
    }));

    const { data: drafts, error } = await db
      .from("drafts")
      .insert(
        planned.map((p) => ({
          company_id: COMPANY,
          founder_id: CTO,
          target_month: "2032-02-01",
          brief_version_id: "00000000-0000-4000-8000-0000000000b1",
          status: p.status,
          is_external: p.isExternal,
          scheduled_for: p.scheduledFor,
        })),
      )
      .select("id");
    expect(error).toBeNull();
    const ids = drafts!.map((d) => d.id);
    const { data: versions, error: versionError } = await db
      .from("draft_versions")
      .insert(
        planned.map((p, i) => ({
          draft_id: ids[i],
          company_id: COMPANY,
          founder_id: CTO,
          version_no: 1,
          body: p.body,
          author_kind: "ai" as const,
        })),
      )
      .select("id, draft_id, body_normalized_hash");
    expect(versionError).toBeNull();
    const versionOf = new Map(versions!.map((v) => [v.draft_id, v]));
    for (const id of ids) {
      const { error: linkError } = await db
        .from("drafts")
        .update({ current_version_id: versionOf.get(id)!.id })
        .eq("id", id);
      expect(linkError).toBeNull();
    }
    const approvals = planned.flatMap((p, i) =>
      p.approve
        ? [
            {
              company_id: COMPANY,
              draft_id: ids[i],
              draft_version_id: versionOf.get(ids[i])!.id,
              body_hash: versionOf.get(ids[i])!.body_normalized_hash,
              approver_user_id: CTO_USER,
              approver_role: "founder" as const,
              decision: "approved" as const,
            },
          ]
        : [],
    );
    expect((await db.from("approvals").insert(approvals)).error).toBeNull();
    const { data: example } = await db
      .from("writing_examples")
      .select("id")
      .eq("kind", "published_linkedin")
      .limit(1)
      .single();
    const flags = planned.flatMap((p, i) =>
      p.repeats
        ? [
            {
              draft_version_id: versionOf.get(ids[i])!.id,
              company_id: COMPANY,
              kind: "repetition" as const,
              severity: "warning" as const,
              source: "repetition",
              message: "Repeats a published post",
              compared_type: "published_post",
              compared_id: example!.id,
            },
          ]
        : [],
    );
    expect((await db.from("review_flags").insert(flags)).error).toBeNull();

    const { from, to } = PERIOD;
    const { data: rows, error: bucketError } = await db.rpc("coverage_draft_buckets", {
      p_founder_id: CTO,
      p_from: from,
      p_to: to,
    });
    expect(bucketError).toBeNull();
    const byId = new Map(rows!.map((r) => [r.draft_id, r]));
    planned.forEach((p, i) => {
      const row = byId.get(ids[i])!;
      // The facts SQL derived are the ones written.
      expect({
        valid: row.valid_approval,
        repeats: row.repeats_published,
        on: row.scheduled_on,
      }).toEqual({ valid: p.approve, repeats: p.repeats, on: p.scheduledFor?.slice(0, 10) ?? null });
    });
    // Every row's bucket, SQL against TypeScript, from the same facts.
    const facts = rows!.map((r) => ({
      status: r.status,
      isExternal: r.is_external,
      validApproval: r.valid_approval,
      repeatsPublished: r.repeats_published,
      scheduledOn: r.scheduled_on,
    }));
    for (const [i, r] of rows!.entries()) expect(r.bucket).toBe(bucketOf(facts[i], PERIOD));
    // Every bucket was exercised.
    expect(new Set(rows!.map((r) => r.bucket))).toEqual(new Set(BUCKETS));

    // And the totals coverage() reports are the TypeScript bucket counts.
    const counts = countBuckets(facts, PERIOD);
    const { data: cov, error: coverageError } = await db
      .rpc("coverage", { p_founder_id: CTO, p_from: from, p_to: to, p_today: from })
      .single();
    expect(coverageError).toBeNull();
    expect({
      scheduled: cov!.scheduled,
      approved_unscheduled: cov!.approved_unscheduled,
      founder_review: cov!.in_founder_review,
      admin_review: cov!.in_admin_review,
      scheduled_other_period: cov!.scheduled_other_period,
      held_repeat: cov!.held_repeat,
      approval_invalid: cov!.approval_invalid,
      published: cov!.published_drafts,
      external: cov!.external_drafts,
      excluded: cov!.excluded,
    }).toEqual(counts);
  });
});
