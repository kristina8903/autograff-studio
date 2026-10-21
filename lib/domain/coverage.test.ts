import { describe, expect, it } from "vitest";
import { countSlots, coverage, type SlotRow } from "./coverage";

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
