// Content coverage per founder and month (docs/DATA_MODEL.md §12).
// Phase 2 has slots only: the draft buckets are wired in and return zero until
// drafts exist (Phase 4 and later). public.coverage_slot_counts() computes the
// slot counts in SQL; tests/db/coverage-parity.test.ts checks the two agree.

import type { MonthTargets } from "./cadence";

export type SlotStatus = "open" | "filled" | "skipped";
export type StoredSlotKind = "regular" | "reserved_timely" | "manual";
export type SlotRow = { kind: StoredSlotKind; status: SlotStatus };

export type SlotCounts = {
  /** Slots to fill: every slot that is not skipped. */
  required: number;
  reservedTimely: number;
  open: number;
  filled: number;
  skipped: number;
};

export function countSlots(slots: SlotRow[]): SlotCounts {
  const live = slots.filter((s) => s.status !== "skipped");
  return {
    required: live.length,
    reservedTimely: live.filter((s) => s.kind === "reserved_timely").length,
    open: slots.filter((s) => s.status === "open").length,
    filled: slots.filter((s) => s.status === "filled").length,
    skipped: slots.filter((s) => s.status === "skipped").length,
  };
}

/** Supply from drafts and publications. All zero until those tables exist. */
export type DraftSupply = {
  published: number;
  scheduled: number;
  approvedUnscheduled: number;
  inFounderReview: number;
  inAdminReview: number;
  conceptsWaiting: number;
};

export const NO_SUPPLY: DraftSupply = {
  published: 0,
  scheduled: 0,
  approvedUnscheduled: 0,
  inFounderReview: 0,
  inAdminReview: 0,
  conceptsWaiting: 0,
};

export type Coverage = SlotCounts &
  DraftSupply & {
    targets: MonthTargets;
    remainingSlots: number;
    usableBuffer: number;
    supplyGap: number;
  };

export function coverage(slots: SlotRow[], targets: MonthTargets, supply: DraftSupply = NO_SUPPLY): Coverage {
  const counts = countSlots(slots);
  const remainingSlots = Math.max(0, counts.required - supply.published - supply.scheduled);
  const usableBuffer = supply.approvedUnscheduled;
  return {
    ...counts,
    ...supply,
    targets,
    remainingSlots,
    usableBuffer,
    supplyGap: Math.max(0, remainingSlots - usableBuffer),
  };
}
