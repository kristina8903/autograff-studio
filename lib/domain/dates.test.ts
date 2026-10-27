import { describe, expect, it } from "vitest";
import { localDateTime, zonedToUtc } from "./dates";

describe("scheduling times in the founder's time zone", () => {
  it("converts a local time to the instant, both ways", () => {
    const at = zonedToUtc("2026-11-03T09:30", "America/Los_Angeles");
    expect(at?.toISOString()).toBe("2026-11-03T17:30:00.000Z");
    expect(localDateTime("America/Los_Angeles", at!)).toBe("2026-11-03T09:30");
    expect(zonedToUtc("2026-07-01T09:30", "Europe/Berlin")?.toISOString()).toBe("2026-07-01T07:30:00.000Z");
    expect(zonedToUtc("2026-07-01T09:30", "UTC")?.toISOString()).toBe("2026-07-01T09:30:00.000Z");
  });

  it("handles the daylight-saving changes", () => {
    // Clocks go back on 2026-11-01 in Los Angeles: 01:30 happens twice; the earlier one is used.
    expect(zonedToUtc("2026-11-01T01:30", "America/Los_Angeles")?.toISOString()).toBe("2026-11-01T08:30:00.000Z");
    // Clocks go forward on 2026-03-08: 02:30 doesn't exist; the time after the jump is used.
    const gap = zonedToUtc("2026-03-08T02:30", "America/Los_Angeles");
    expect(gap?.toISOString()).toBe("2026-03-08T10:30:00.000Z");
  });

  it("refuses anything that isn't a date and time", () => {
    for (const bad of ["", "2026-11-03", "2026-02-30T09:00", "2026-11-03T25:00", "tomorrow"])
      expect(zonedToUtc(bad, "UTC"), bad).toBeNull();
  });
});
