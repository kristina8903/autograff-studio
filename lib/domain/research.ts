// Research rules (docs/INTEGRATIONS.md §3, SECURITY §6). Pure: sources come
// from the web, so everything here treats their text as untrusted data.

export type DatePrecision = "day" | "month" | "year" | "unknown";
export type DatedValue = { date: string | null; precision: DatePrecision };

/** Price of one web search on the Claude API: $10 per 1,000 [V] (INTEGRATIONS §3.2). */
export const WEB_SEARCH_USD = 0.01;
/** Searches per research run, and characters kept per source. */
export const MAX_SEARCHES_PER_RUN = 5;
export const MAX_EXCERPT_CHARACTERS = 3000;

// ---------------------------------------------------------------------------
// URLs and domains
// ---------------------------------------------------------------------------

const TRACKING_PARAM = /^(utm_[a-z]+|gclid|fbclid|mc_[a-z]+|ref|ref_src)$/i;

/** An http(s) URL, or null. Anything else (javascript:, data:, relative) is refused. */
export function parseWebUrl(raw: string): URL | null {
  try {
    const url = new URL(raw.trim());
    return url.protocol === "https:" || url.protocol === "http:" ? url : null;
  } catch {
    return null;
  }
}

/**
 * The form a source is stored under, so the same page found twice is stored
 * once: https, lowercase host without "www.", no fragment, no tracking
 * parameters, no trailing slash.
 */
export function canonicalUrl(raw: string): string | null {
  const url = parseWebUrl(raw);
  if (!url) return null;
  url.protocol = "https:";
  url.hostname = url.hostname.toLowerCase().replace(/^www\./, "");
  url.hash = "";
  url.port = "";
  for (const key of [...url.searchParams.keys()]) if (TRACKING_PARAM.test(key)) url.searchParams.delete(key);
  url.searchParams.sort();
  if (url.pathname.length > 1) url.pathname = url.pathname.replace(/\/+$/, "");
  return url.toString().replace(/\/(?=$|\?)/, "");
}

export function hostOf(raw: string): string | null {
  return (
    parseWebUrl(raw)
      ?.hostname.toLowerCase()
      .replace(/^www\./, "") ?? null
  );
}

const HOSTNAME = /^(?=.{1,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;

/**
 * A domain list from the admin: one per line or comma-separated, without a
 * scheme. Returns the valid hostnames and the entries that were not.
 */
export function parseDomainList(input: string): { domains: string[]; invalid: string[] } {
  const entries = input
    .split(/[\s,]+/)
    .map((e) =>
      e
        .trim()
        .toLowerCase()
        .replace(/^https?:\/\//, "")
        .replace(/^www\./, "")
        .replace(/\/.*$/, ""),
    )
    .filter(Boolean);
  const domains = [...new Set(entries.filter((e) => HOSTNAME.test(e)))];
  return { domains, invalid: entries.filter((e) => !HOSTNAME.test(e)) };
}

/** Whether a host is the domain or one of its subdomains. */
export function onDomain(host: string, domain: string): boolean {
  return host === domain || host.endsWith(`.${domain}`);
}

/**
 * Our own filter, applied to every provider's results whatever the provider
 * did: an allow list, when set, admits only its domains; a blocked domain is
 * always dropped.
 */
export function domainAllowed(url: string, lists: { allowed: string[]; blocked: string[] }): boolean {
  const host = hostOf(url);
  if (!host) return false;
  if (lists.blocked.some((d) => onDomain(host, d))) return false;
  return lists.allowed.length === 0 || lists.allowed.some((d) => onDomain(host, d));
}

// ---------------------------------------------------------------------------
// Dates
// ---------------------------------------------------------------------------

const MONTHS = [
  "january",
  "february",
  "march",
  "april",
  "may",
  "june",
  "july",
  "august",
  "september",
  "october",
  "november",
  "december",
];
const pad = (n: number) => String(n).padStart(2, "0");

function validDay(y: number, m: number, d: number): string | null {
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d
    ? `${y}-${pad(m)}-${pad(d)}`
    : null;
}

function monthIndex(name: string): number {
  const i = MONTHS.findIndex((m) => m.startsWith(name.toLowerCase().slice(0, 3)));
  return name.length >= 3 ? i + 1 : 0;
}

/**
 * Reads a date as a provider or model gives it ("2026-03-04", "March 4,
 * 2026", "4 March 2026", "Mar 2026", "2026", "3 days ago") into an ISO date
 * and how precise it is. A month or year is stored as its first day. Anything
 * else is unknown: never guessed. Relative ages count back from `now`.
 */
export function parseLooseDate(raw: string | null | undefined, now: Date = new Date()): DatedValue {
  const text = (raw ?? "").trim().toLowerCase().replace(/,/g, "");
  if (!text) return { date: null, precision: "unknown" };
  let m: RegExpMatchArray | null;
  const ok = (date: string | null, precision: DatePrecision): DatedValue =>
    date && date <= isoDay(now) ? { date, precision } : { date: null, precision: "unknown" };

  if ((m = text.match(/^(\d{4})-(\d{2})-(\d{2})(?:t.*)?$/))) return ok(validDay(+m[1], +m[2], +m[3]), "day");
  if ((m = text.match(/^(\d{4})-(\d{2})$/))) return ok(validDay(+m[1], +m[2], 1), "month");
  if ((m = text.match(/^(\d{4})$/))) return ok(validDay(+m[1], 1, 1), "year");
  if ((m = text.match(/^([a-z]+)\.? (\d{1,2}) (\d{4})$/)) && monthIndex(m[1]))
    return ok(validDay(+m[3], monthIndex(m[1]), +m[2]), "day");
  if ((m = text.match(/^(\d{1,2}) ([a-z]+)\.? (\d{4})$/)) && monthIndex(m[2]))
    return ok(validDay(+m[3], monthIndex(m[2]), +m[1]), "day");
  if ((m = text.match(/^([a-z]+)\.? (\d{4})$/)) && monthIndex(m[1]))
    return ok(validDay(+m[2], monthIndex(m[1]), 1), "month");
  if ((m = text.match(/^(\d+) (minute|hour|day|week|month|year)s? ago$/))) {
    const n = +m[1];
    const d = new Date(now);
    if (m[2] === "minute" || m[2] === "hour") return ok(isoDay(d), "day");
    if (m[2] === "day") d.setUTCDate(d.getUTCDate() - n);
    if (m[2] === "week") d.setUTCDate(d.getUTCDate() - 7 * n);
    if (m[2] === "month") d.setUTCMonth(d.getUTCMonth() - n);
    if (m[2] === "year") d.setUTCFullYear(d.getUTCFullYear() - n);
    const day = isoDay(d);
    if (m[2] === "month") return ok(`${day.slice(0, 7)}-01`, "month");
    if (m[2] === "year") return ok(`${day.slice(0, 4)}-01-01`, "year");
    return ok(day, "day");
  }
  return { date: null, precision: "unknown" };
}

function isoDay(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** "March 4, 2026", "March 2026", "2026" or "Date unknown". */
export function dateLabel(date: string | null, precision: DatePrecision): string {
  if (!date || precision === "unknown") return "Date unknown";
  const [y, m, d] = date.split("-").map(Number);
  const month = MONTHS[m - 1].charAt(0).toUpperCase() + MONTHS[m - 1].slice(1);
  if (precision === "year") return String(y);
  if (precision === "month") return `${month} ${y}`;
  return `${month} ${d}, ${y}`;
}

// ---------------------------------------------------------------------------
// Findings: validation against the excerpt (acceptance criterion 2)
// ---------------------------------------------------------------------------

/** Lowercase, straight quotes, dashes as hyphens, single spaces: for "is this text in the excerpt". */
export function matchable(text: string): string {
  return text
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[‘’‛]/g, "'")
    .replace(/[“”‟]/g, '"')
    .replace(/[‐-―]/g, "-")
    .replace(/\s+/g, " ")
    .trim();
}

/** Every number in a text, as written without thousands separators: "1,200" → "1200", "27%" → "27", "3.5" → "3.5". */
export function numbersIn(text: string): string[] {
  return [...text.matchAll(/\d[\d,]*(?:\.\d+)?/g)]
    .map((m) => m[0].replace(/,(?=\d{3}\b)/g, "").replace(/,$/, ""))
    .map((n) => n.replace(/\.0+$/, ""));
}

const URL_IN_TEXT = /\bhttps?:\/\/|\bwww\.|\b[a-z0-9-]+\.(?:com|org|net|io|ai|co|gov|edu)\b/i;

export type ExtractedFinding = {
  source: number;
  claim: string;
  quote: string | null;
  value: string | null;
  unit: string | null;
  population: string | null;
  period: string | null;
  event_date: string | null;
};

export type FindingRecord = {
  claim_text: string;
  quote: string | null;
  data: { value: string; unit: string | null; population: string | null; period: string | null } | null;
  event_date: string | null;
  event_date_precision: DatePrecision;
  verification_status: "unverified" | "machine_supported";
};

export type FindingCheck = { ok: true; record: FindingRecord } | { ok: false; reason: string };

/**
 * A model-extracted finding is kept only if everything it asserts can be
 * found in the excerpt it came from:
 * - its quote, word for word (ignoring case, quote style and spacing);
 * - every number in its claim and data;
 * - no web address of any kind (a source URL comes only from the provider).
 * A finding whose claim states no number and has no quote is kept as
 * unverified: a person must check it.
 */
export function checkFinding(finding: ExtractedFinding, excerpt: string, now: Date = new Date()): FindingCheck {
  const claim = finding.claim.trim();
  if (claim.length < 5 || claim.length > 1000) return { ok: false, reason: "claim length" };
  const asserted = [claim, finding.quote, finding.value, finding.unit, finding.population, finding.period]
    .filter(Boolean)
    .join(" ");
  if (URL_IN_TEXT.test(asserted)) return { ok: false, reason: "contains a web address" };

  const haystack = matchable(excerpt);
  const quote = finding.quote?.trim() || null;
  if (quote && (quote.length > 1000 || !haystack.includes(matchable(quote))))
    return { ok: false, reason: "quote not in excerpt" };
  const excerptNumbers = new Set(numbersIn(excerpt));
  const missing = numbersIn([claim, finding.value ?? "", finding.period ?? ""].join(" ")).filter(
    (n) => !excerptNumbers.has(n),
  );
  if (missing.length) return { ok: false, reason: "number not in excerpt" };

  const event = parseLooseDate(finding.event_date, now);
  const value = finding.value?.trim() || null;
  return {
    ok: true,
    record: {
      claim_text: claim,
      quote,
      data: value
        ? {
            value,
            unit: finding.unit?.trim() || null,
            population: finding.population?.trim() || null,
            period: finding.period?.trim() || null,
          }
        : null,
      event_date: event.date,
      event_date_precision: event.precision,
      verification_status: quote || numbersIn(claim).length ? "machine_supported" : "unverified",
    },
  };
}
