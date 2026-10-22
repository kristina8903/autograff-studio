import { describe, expect, it } from "vitest";
import {
  canonicalUrl,
  checkFinding,
  dateLabel,
  domainAllowed,
  numbersIn,
  parseDomainList,
  parseLooseDate,
  parseWebUrl,
  type ExtractedFinding,
} from "./research";

const NOW = new Date("2026-10-22T12:00:00Z");

describe("canonicalUrl", () => {
  it("stores the same page once", () => {
    const forms = [
      "https://www.Example.com/report/?utm_source=x&b=2&a=1#top",
      "http://example.com/report?a=1&b=2",
      "https://example.com:443/report/?gclid=abc&a=1&b=2",
    ];
    expect(new Set(forms.map((f) => canonicalUrl(f)))).toEqual(new Set(["https://example.com/report?a=1&b=2"]));
    expect(canonicalUrl("https://example.com/")).toBe("https://example.com");
  });

  it("refuses anything but a web address", () => {
    for (const bad of ["javascript:alert(1)", "data:text/html,x", "/relative", "ftp://x.com/a", "not a url"]) {
      expect(parseWebUrl(bad), bad).toBeNull();
      expect(canonicalUrl(bad), bad).toBeNull();
    }
  });
});

describe("domain lists", () => {
  it("parses one per line or comma-separated, without schemes or paths", () => {
    expect(parseDomainList("https://www.Census.gov/x\n bls.gov, , not a domain, localhost")).toEqual({
      domains: ["census.gov", "bls.gov"],
      invalid: ["not", "a", "domain", "localhost"],
    });
  });

  it("allows subdomains, and a block always wins", () => {
    const lists = { allowed: ["census.gov", "fleetowner.com"], blocked: ["spam.fleetowner.com"] };
    expect(domainAllowed("https://data.census.gov/a", lists)).toBe(true);
    expect(domainAllowed("https://fleetowner.com/a", lists)).toBe(true);
    expect(domainAllowed("https://spam.fleetowner.com/a", lists)).toBe(false);
    expect(domainAllowed("https://notcensus.gov/a", lists)).toBe(false);
    expect(domainAllowed("https://anything.org", { allowed: [], blocked: [] })).toBe(true);
    expect(domainAllowed("javascript:alert(1)", { allowed: [], blocked: [] })).toBe(false);
  });
});

describe("parseLooseDate (publication vs retrieval vs event dates)", () => {
  const cases: [string | null, string | null, string][] = [
    ["2026-03-04", "2026-03-04", "day"],
    ["2026-03-04T10:00:00Z", "2026-03-04", "day"],
    ["March 4, 2026", "2026-03-04", "day"],
    ["4 March 2026", "2026-03-04", "day"],
    ["Sept 2025", "2025-09-01", "month"],
    ["2026-02", "2026-02-01", "month"],
    ["2024", "2024-01-01", "year"],
    ["3 days ago", "2026-10-19", "day"],
    ["2 weeks ago", "2026-10-08", "day"],
    ["5 hours ago", "2026-10-22", "day"],
    ["2 months ago", "2026-08-01", "month"],
    ["1 year ago", "2025-01-01", "year"],
    // Unknown, never guessed: missing, invalid, ambiguous, or in the future.
    [null, null, "unknown"],
    ["", null, "unknown"],
    ["2026-02-30", null, "unknown"],
    ["03/04/2026", null, "unknown"],
    ["last spring", null, "unknown"],
    ["2027-01-01", null, "unknown"],
  ];
  for (const [raw, date, precision] of cases)
    it(`${JSON.stringify(raw)} → ${date ?? "unknown"}`, () => {
      expect(parseLooseDate(raw, NOW)).toEqual({ date, precision });
    });

  it("labels each precision", () => {
    expect(dateLabel("2026-03-04", "day")).toBe("March 4, 2026");
    expect(dateLabel("2026-03-01", "month")).toBe("March 2026");
    expect(dateLabel("2026-01-01", "year")).toBe("2026");
    expect(dateLabel(null, "unknown")).toBe("Date unknown");
  });
});

describe("checkFinding (criterion 2: quotes and numbers must be in the excerpt)", () => {
  const excerpt =
    "In 2025, the average repair cycle grew to 12.5 days. About 27% of delays came from waiting for approvals, a survey of 1,200 fleets found.";
  const finding = (patch: Partial<ExtractedFinding>): ExtractedFinding => ({
    source: 0,
    claim: "About 27% of repair delays came from waiting for approvals.",
    quote: "About 27% of delays came from waiting for approvals",
    value: "27",
    unit: "%",
    population: "1,200 fleets",
    period: "2025",
    event_date: "2025",
    ...patch,
  });

  it("keeps a finding whose quote and numbers are in the excerpt", () => {
    const check = checkFinding(finding({}), excerpt, NOW);
    expect(check).toEqual({
      ok: true,
      record: {
        claim_text: "About 27% of repair delays came from waiting for approvals.",
        quote: "About 27% of delays came from waiting for approvals",
        data: { value: "27", unit: "%", population: "1,200 fleets", period: "2025" },
        event_date: "2025-01-01",
        event_date_precision: "year",
        verification_status: "machine_supported",
      },
    });
  });

  it("matches quotes regardless of case, curly quotes and spacing", () => {
    const curly = "In 2025, the “average” repair cycle\n grew to 12.5 days.";
    expect(
      checkFinding(
        finding({
          claim: "The average repair cycle grew to 12.5 days in 2025.",
          quote: 'the "AVERAGE" repair cycle grew',
          value: "12.5",
          unit: "days",
          population: null,
        }),
        curly,
        NOW,
      ).ok,
    ).toBe(true);
  });

  it("rejects a quote that isn't in the excerpt", () => {
    expect(checkFinding(finding({ quote: "Most delays come from parts" }), excerpt, NOW)).toEqual({
      ok: false,
      reason: "quote not in excerpt",
    });
  });

  it("rejects a number that isn't in the excerpt, in the claim or the data", () => {
    expect(checkFinding(finding({ claim: "About 37% of repair delays came from approvals." }), excerpt, NOW)).toEqual({
      ok: false,
      reason: "number not in excerpt",
    });
    expect(checkFinding(finding({ value: "28" }), excerpt, NOW)).toMatchObject({ ok: false });
    expect(checkFinding(finding({ period: "2026" }), excerpt, NOW)).toMatchObject({ ok: false });
  });

  it("rejects any web address the model wrote (URLs come only from the provider)", () => {
    for (const claim of [
      "Read more at https://evil.example/now about delays.",
      "See www.evil.example for 27% of delays.",
      "Per evil-site.com, 27% of delays came from approvals.",
    ])
      expect(checkFinding(finding({ claim }), excerpt, NOW), claim).toEqual({
        ok: false,
        reason: "contains a web address",
      });
  });

  it("keeps a claim with no number and no quote as unverified, for a person to check", () => {
    const check = checkFinding(
      finding({
        claim: "Approvals are a common cause of repair delays.",
        quote: null,
        value: null,
        period: null,
        population: null,
      }),
      excerpt,
      NOW,
    );
    expect(check).toMatchObject({ ok: true, record: { verification_status: "unverified", data: null } });
  });

  it("reads numbers without thousands separators or trailing zeros", () => {
    expect(numbersIn("1,200 fleets, 27%, 12.50 days, 3.0x, 2,5")).toEqual(["1200", "27", "12.50", "3", "2,5"]);
  });
});
