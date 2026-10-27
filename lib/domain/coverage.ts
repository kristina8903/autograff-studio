// Content coverage per founder and period (docs/DATA_MODEL.md §12, D-35).
// Every draft lands in exactly one bucket (bucketOf), so nothing is counted
// twice. public.coverage() and public.coverage_draft_buckets() compute the same
// in SQL; tests/db/coverage-parity.test.ts checks the two agree.

import type { MonthTargets } from "./cadence";
import { daysBetween, type IsoDate } from "./dates";

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

// ---------------------------------------------------------------------------
// One bucket per draft
// ---------------------------------------------------------------------------

export type DraftStatus =
  | "drafting"
  | "admin_review"
  | "founder_review"
  | "changes_requested"
  | "approved"
  | "scheduled"
  | "published"
  | "rejected"
  | "archived";

/** What decides a draft's bucket. */
export type DraftFacts = {
  status: DraftStatus;
  isExternal: boolean;
  /** The founder's approval of the current version is valid. */
  validApproval: boolean;
  /** An open repetition warning says it repeats published content. */
  repeatsPublished: boolean;
  /** The scheduled date in the founder's time zone. */
  scheduledOn: IsoDate | null;
};

/** A period of whole days: `from` inclusive, `to` exclusive. */
export type Period = { from: IsoDate; to: IsoDate };

export const BUCKETS = [
  // Supply.
  "scheduled",
  "approved_unscheduled",
  // Pipeline: shown, never counted as supply.
  "founder_review",
  "admin_review",
  // Never supply.
  "scheduled_other_period",
  "held_repeat",
  "approval_invalid",
  "published",
  "external",
  "excluded",
] as const;
export type Bucket = (typeof BUCKETS)[number];

export function bucketOf(d: DraftFacts, period: Period): Bucket {
  if (d.isExternal) return "external";
  switch (d.status) {
    case "rejected":
    case "archived":
      return "excluded";
    case "published":
      return "published";
    case "scheduled":
      if (!d.validApproval) return "approval_invalid";
      return d.scheduledOn !== null && d.scheduledOn >= period.from && d.scheduledOn < period.to
        ? "scheduled"
        : "scheduled_other_period";
    case "approved":
      if (!d.validApproval) return "approval_invalid";
      return d.repeatsPublished ? "held_repeat" : "approved_unscheduled";
    case "founder_review":
      return "founder_review";
    case "drafting":
    case "admin_review":
    case "changes_requested":
      return "admin_review";
  }
}

export type BucketCounts = Record<Bucket, number>;

export function countBuckets(drafts: DraftFacts[], period: Period): BucketCounts {
  const counts = Object.fromEntries(BUCKETS.map((b) => [b, 0])) as BucketCounts;
  for (const d of drafts) counts[bucketOf(d, period)] += 1;
  return counts;
}

// ---------------------------------------------------------------------------
// Coverage
// ---------------------------------------------------------------------------

/** Supply from drafts and publications in the period. */
export type DraftSupply = {
  /** Publications (studio and external) dated in the period. */
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
    /** Drafts in review and concepts waiting: shown, never counted as supply. */
    pipelineAfter: number;
  };

export function coverage(slots: SlotRow[], targets: MonthTargets, supply: DraftSupply = NO_SUPPLY): Coverage {
  return fromCounts(countSlots(slots), targets, supply);
}

export function fromCounts(counts: SlotCounts, targets: MonthTargets, supply: DraftSupply): Coverage {
  const remainingSlots = Math.max(0, counts.required - supply.published - supply.scheduled);
  const usableBuffer = supply.approvedUnscheduled;
  return {
    ...counts,
    ...supply,
    targets,
    remainingSlots,
    usableBuffer,
    supplyGap: Math.max(0, remainingSlots - usableBuffer),
    pipelineAfter: supply.inFounderReview + supply.inAdminReview + supply.conceptsWaiting,
  };
}

export type BufferRule = { bufferTarget: number; lowBufferThreshold: number };

export type CoverageStatus = "covered" | "at_risk" | "short";

/** A gap with an open slot this close is short, whatever is in review. */
export const SHORT_HORIZON_DAYS = 7;

/**
 * DATA_MODEL §12.3. `nextOpenSlot`: the founder's next open slot from today,
 * or null.
 */
export function coverageStatus(
  c: Pick<Coverage, "supplyGap" | "usableBuffer" | "pipelineAfter">,
  rule: BufferRule,
  today: IsoDate,
  nextOpenSlot: IsoDate | null,
): CoverageStatus {
  if (c.supplyGap === 0) return c.usableBuffer >= rule.bufferTarget ? "covered" : "at_risk";
  if (nextOpenSlot !== null && daysBetween(today, nextOpenSlot) <= SHORT_HORIZON_DAYS) return "short";
  return c.supplyGap <= c.pipelineAfter ? "at_risk" : "short";
}

/** The shortfall flag: fewer approved posts in hand than the founder's threshold. */
export function isShortfall(usableBuffer: number, rule: BufferRule): boolean {
  return usableBuffer < rule.lowBufferThreshold;
}

// ---------------------------------------------------------------------------
// Replenishment (DATA_MODEL §12.4)
// ---------------------------------------------------------------------------

export const DEFAULT_BATCH_SIZE_CONCEPTS = 5;

export type ReplenishmentInput = {
  candidateTargetMax: number;
  /** Concepts proposed or selected for the month, with no live draft. */
  conceptsOpen: number;
  /** Live drafts for the month not yet approved. */
  draftsInProgress: number;
  usableBuffer: number;
  /** Scheduled for the month. */
  scheduled: number;
  batchSize: number;
};

export type Replenishment = { candidatesExisting: number; need: number; batch: number };

export function replenishment(r: ReplenishmentInput): Replenishment {
  const candidatesExisting = r.conceptsOpen + r.draftsInProgress;
  const need = Math.max(0, r.candidateTargetMax - candidatesExisting - r.usableBuffer - r.scheduled);
  return { candidatesExisting, need, batch: Math.max(0, Math.min(need, r.batchSize)) };
}
