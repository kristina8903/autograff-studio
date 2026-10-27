import { describe, expect, it } from "vitest";
import {
  BUCKETS,
  SHORT_HORIZON_DAYS,
  bucketOf,
  countBuckets,
  countSlots,
  coverage,
  coverageStatus,
  isShortfall,
  replenishment,
  type Bucket,
  type DraftFacts,
  type DraftStatus,
  type Period,
  type SlotRow,
} from "./coverage";

const slots: SlotRow[] = [
  { kind: "regular", status: "open" },
  { kind: "regular", status: "open" },
  { kind: "reserved_timely", status: "open" },
  { kind: "manual", status: "open" },
  { kind: "regular", status: "skipped" },
  { kind: "reserved_timely", status: "skipped" },
  { kind: "regular", status: "filled" },
];

describe("coverage", () => {
  it("counts each slot exactly once and never counts skipped slots as required", () => {
    const counts = countSlots(slots);
    expect(counts).toEqual({ required: 5, reservedTimely: 1, open: 4, filled: 1, skipped: 2 });
    expect(counts.open + counts.filled + counts.skipped).toBe(slots.length);
  });

  it("has zero supply until drafts exist, so every required slot is a gap", () => {
    const c = coverage(slots, { min: 4, target: 5, max: 6 });
    expect(c.targets).toEqual({ min: 4, target: 5, max: 6 });
    expect(c.remainingSlots).toBe(5);
    expect(c.usableBuffer).toBe(0);
    expect(c.supplyGap).toBe(5);
    expect(c.published + c.scheduled + c.inFounderReview + c.inAdminReview + c.conceptsWaiting).toBe(0);
  });

  it("subtracts published and scheduled posts, and counts only approved unscheduled posts as buffer", () => {
    const c = coverage(
      slots,
      { min: 4, target: 5, max: 6 },
      {
        published: 1,
        scheduled: 1,
        approvedUnscheduled: 2,
        inFounderReview: 4,
        inAdminReview: 3,
        conceptsWaiting: 9,
      },
    );
    expect(c.remainingSlots).toBe(3);
    expect(c.supplyGap).toBe(1); // drafts in review are pipeline, never supply
  });

  it("never reports negative remaining slots", () => {
    expect(
      coverage(
        [],
        { min: 0, target: 0, max: 0 },
        {
          published: 2,
          scheduled: 0,
          approvedUnscheduled: 0,
          inFounderReview: 0,
          inAdminReview: 0,
          conceptsWaiting: 0,
        },
      ).remainingSlots,
    ).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// One bucket per draft: property tests on random draft sets
// ---------------------------------------------------------------------------

/** A small seeded generator, so a failure always reproduces. */
function prng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

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
const PERIOD: Period = { from: "2026-11-01", to: "2027-01-01" };
const SUPPLY: Bucket[] = ["scheduled", "approved_unscheduled"];

function randomDrafts(seed: number): DraftFacts[] {
  const rand = prng(seed);
  const pick = <T>(items: readonly T[]) => items[Math.floor(rand() * items.length)];
  return Array.from({ length: Math.floor(rand() * 40) }, () => {
    const status = pick(STATUSES);
    return {
      status,
      isExternal: rand() < 0.1,
      validApproval: rand() < 0.8,
      repeatsPublished: rand() < 0.2,
      scheduledOn:
        status === "scheduled" || status === "published"
          ? pick(["2026-10-31", "2026-11-01", "2026-12-31", "2027-01-01"])
          : null,
    };
  });
}

describe("one bucket per draft", () => {
  it("puts every draft in exactly one bucket: the buckets sum to the drafts", () => {
    for (let seed = 1; seed <= 500; seed++) {
      const drafts = randomDrafts(seed);
      const counts = countBuckets(drafts, PERIOD);
      expect(BUCKETS.reduce((sum, b) => sum + counts[b], 0)).toBe(drafts.length);
      for (const d of drafts) expect(BUCKETS.filter((b) => b === bucketOf(d, PERIOD))).toHaveLength(1);
    }
  });

  it("never counts rejected, archived, external, pending, repeated or unapproved drafts as supply", () => {
    for (let seed = 1; seed <= 500; seed++) {
      for (const d of randomDrafts(seed)) {
        if (!SUPPLY.includes(bucketOf(d, PERIOD))) continue;
        expect(d.isExternal).toBe(false);
        expect(["approved", "scheduled"]).toContain(d.status);
        expect(d.validApproval).toBe(true);
        if (d.status === "approved") expect(d.repeatsPublished).toBe(false);
        if (d.status === "scheduled") expect(d.scheduledOn! >= PERIOD.from && d.scheduledOn! < PERIOD.to).toBe(true);
      }
    }
  });

  it("counts a scheduled draft only in the period of its date (from inclusive, to exclusive)", () => {
    const at = (scheduledOn: string): DraftFacts => ({
      status: "scheduled",
      isExternal: false,
      validApproval: true,
      repeatsPublished: false,
      scheduledOn,
    });
    expect(bucketOf(at("2026-10-31"), PERIOD)).toBe("scheduled_other_period");
    expect(bucketOf(at("2026-11-01"), PERIOD)).toBe("scheduled");
    expect(bucketOf(at("2026-12-31"), PERIOD)).toBe("scheduled");
    expect(bucketOf(at("2027-01-01"), PERIOD)).toBe("scheduled_other_period");
  });

  it("treats a lost approval as neither scheduled nor buffer", () => {
    const base = { isExternal: false, validApproval: false, repeatsPublished: false, scheduledOn: "2026-11-10" };
    expect(bucketOf({ ...base, status: "scheduled" }, PERIOD)).toBe("approval_invalid");
    expect(bucketOf({ ...base, status: "approved", scheduledOn: null }, PERIOD)).toBe("approval_invalid");
  });
});

// ---------------------------------------------------------------------------
// Status, shortfall and replenishment thresholds
// ---------------------------------------------------------------------------

describe("coverage status", () => {
  const rule = { bufferTarget: 3, lowBufferThreshold: 2 };
  const today = "2026-11-01";

  it("is covered with no gap and a full buffer, at risk with a short buffer", () => {
    expect(coverageStatus({ supplyGap: 0, usableBuffer: 3, pipelineAfter: 0 }, rule, today, null)).toBe("covered");
    expect(coverageStatus({ supplyGap: 0, usableBuffer: 2, pipelineAfter: 9 }, rule, today, null)).toBe("at_risk");
  });

  it("is at risk when the pipeline could close the gap, short when it can't", () => {
    expect(coverageStatus({ supplyGap: 3, usableBuffer: 0, pipelineAfter: 3 }, rule, today, "2026-11-20")).toBe(
      "at_risk",
    );
    expect(coverageStatus({ supplyGap: 4, usableBuffer: 0, pipelineAfter: 3 }, rule, today, "2026-11-20")).toBe(
      "short",
    );
  });

  it(`is short when the next open slot is within ${SHORT_HORIZON_DAYS} days, whatever is in review`, () => {
    const c = { supplyGap: 1, usableBuffer: 0, pipelineAfter: 10 };
    expect(coverageStatus(c, rule, today, "2026-11-08")).toBe("short");
    expect(coverageStatus(c, rule, today, "2026-11-09")).toBe("at_risk");
  });

  it("flags a shortfall only when the buffer is below the threshold", () => {
    expect(isShortfall(1, rule)).toBe(true);
    expect(isShortfall(2, rule)).toBe(false);
    expect(isShortfall(0, { bufferTarget: 0, lowBufferThreshold: 0 })).toBe(false);
  });
});

describe("replenishment", () => {
  const base = {
    candidateTargetMax: 20,
    conceptsOpen: 4,
    draftsInProgress: 3,
    usableBuffer: 2,
    scheduled: 1,
    batchSize: 5,
    selectedWaiting: 0,
    batchSizeDrafts: 3,
  };

  it("proposes the need, capped at the batch size", () => {
    expect(replenishment(base)).toEqual({ candidatesExisting: 7, need: 10, batch: 5, draftBatch: 0 });
    expect(replenishment({ ...base, candidateTargetMax: 13 })).toEqual({
      candidatesExisting: 7,
      need: 3,
      batch: 3,
      draftBatch: 0,
    });
  });

  it("proposes nothing when supply is sufficient", () => {
    expect(replenishment({ ...base, candidateTargetMax: 10 }).batch).toBe(0);
    expect(replenishment({ ...base, candidateTargetMax: 0 })).toEqual({
      candidatesExisting: 7,
      need: 0,
      batch: 0,
      draftBatch: 0,
    });
  });

  it("drafts the selected concepts waiting, up to the draft batch size", () => {
    expect(replenishment({ ...base, selectedWaiting: 2 }).draftBatch).toBe(2);
    expect(replenishment({ ...base, selectedWaiting: 7 }).draftBatch).toBe(3);
    expect(replenishment({ ...base, selectedWaiting: 0 }).draftBatch).toBe(0);
    // Even when no new concepts are needed.
    expect(replenishment({ ...base, candidateTargetMax: 0, selectedWaiting: 2 })).toMatchObject({
      batch: 0,
      draftBatch: 2,
    });
  });

  it("never proposes more than the batch size, for any input", () => {
    const rand = prng(42);
    for (let i = 0; i < 1000; i++) {
      const batchSizeDrafts = 1 + Math.floor(rand() * 5);
      const r = replenishment({
        candidateTargetMax: Math.floor(rand() * 30),
        conceptsOpen: Math.floor(rand() * 15),
        draftsInProgress: Math.floor(rand() * 15),
        usableBuffer: Math.floor(rand() * 10),
        scheduled: Math.floor(rand() * 10),
        batchSize: 1 + Math.floor(rand() * 10),
        selectedWaiting: Math.floor(rand() * 10),
        batchSizeDrafts,
      });
      expect(r.batch).toBeGreaterThanOrEqual(0);
      expect(r.batch).toBeLessThanOrEqual(r.need);
      expect(r.draftBatch).toBeGreaterThanOrEqual(0);
      expect(r.draftBatch).toBeLessThanOrEqual(batchSizeDrafts);
    }
  });
});
