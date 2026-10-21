// Checks that SQL public.coverage_slot_counts() and TypeScript countSlots()
// agree on the same slots (docs/PHASES.md Phase 2). Runs against the LOCAL
// Supabase stack only (npm run test:db).
import { createClient } from "@supabase/supabase-js";
import { afterAll, describe, expect, it } from "vitest";
import { countSlots, type SlotRow } from "@/lib/domain/coverage";
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

afterAll(async () => {
  await db.from("calendar_slots").delete().eq("founder_id", COO).gte("slot_date", MONTH);
});

describe("coverage parity", () => {
  it("SQL and TypeScript slot counts agree", async () => {
    const { data: rule } = await db.from("cadence_rules").select("id").eq("founder_id", COO).single();
    const rows = fixtures.map((f) => ({
      company_id: COMPANY,
      founder_id: COO,
      slot_date: `2031-03-${String(f.day).padStart(2, "0")}`,
      kind: f.kind,
      status: f.status,
      cadence_rule_id: f.kind === "manual" ? null : rule!.id,
      draft_id: f.status === "filled" ? crypto.randomUUID() : null,
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
