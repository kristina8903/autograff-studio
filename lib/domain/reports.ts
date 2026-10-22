// Publishing reports (PHASES.md, Phase 9): what was published per founder and
// month against the cadence, which themes and formats, and the manually
// entered metrics. Pure: the page loads the rows, this adds them up.

import { localToday, monthOf, type IsoMonth } from "./dates";

export const METRIC_KEYS = ["impressions", "reactions", "comments", "reshares", "clicks", "followers_gained"] as const;
export type MetricKey = (typeof METRIC_KEYS)[number];
export const METRIC_LABELS: Record<MetricKey, string> = {
  impressions: "Impressions",
  reactions: "Reactions",
  comments: "Comments",
  reshares: "Reposts",
  clicks: "Clicks",
  followers_gained: "Followers gained",
};
export type Metrics = Partial<Record<MetricKey, number>>;

export type PublicationRow = {
  founderId: string;
  publishedAt: string;
  isExternal: boolean;
  /** The concept's format; null for external posts. */
  format: string | null;
  /** The month's brief theme; null for external posts. */
  theme: string | null;
  /** The latest snapshot's metrics, if any were entered. */
  metrics: Metrics | null;
};

export type FounderRef = { id: string; timezone: string };

export type MonthCount = { founderId: string; month: IsoMonth; studio: number; external: number; total: number };

/** Publications per founder and month, in the founder's own calendar. */
export function publishedPerMonth(rows: PublicationRow[], founders: FounderRef[]): MonthCount[] {
  const timezone = new Map(founders.map((f) => [f.id, f.timezone]));
  const counts = new Map<string, MonthCount>();
  for (const row of rows) {
    const tz = timezone.get(row.founderId);
    if (!tz) continue;
    const month = monthOf(localToday(tz, new Date(row.publishedAt)));
    const key = `${row.founderId}|${month}`;
    const c = counts.get(key) ?? { founderId: row.founderId, month, studio: 0, external: 0, total: 0 };
    if (row.isExternal) c.external++;
    else c.studio++;
    c.total++;
    counts.set(key, c);
  }
  return [...counts.values()].sort((a, b) => a.month.localeCompare(b.month) || a.founderId.localeCompare(b.founderId));
}

export type GroupStats = {
  key: string;
  published: number;
  withMetrics: number;
  /** Per metric: the total over posts that recorded it, and how many did. */
  totals: Partial<Record<MetricKey, { sum: number; posts: number }>>;
};

/**
 * Counts and metric totals grouped by a field. External posts have no theme
 * or format and are grouped as "Outside the studio". A metric missing from a
 * snapshot is left out of that metric's average rather than counted as zero.
 */
export function groupBy(rows: PublicationRow[], field: (row: PublicationRow) => string | null): GroupStats[] {
  const groups = new Map<string, GroupStats>();
  for (const row of rows) {
    const key = field(row) ?? (row.isExternal ? "Outside the studio" : "Not recorded");
    const g = groups.get(key) ?? { key, published: 0, withMetrics: 0, totals: {} };
    g.published++;
    if (row.metrics && Object.keys(row.metrics).length) {
      g.withMetrics++;
      for (const metric of METRIC_KEYS) {
        const value = row.metrics[metric];
        if (typeof value !== "number") continue;
        const t = g.totals[metric] ?? { sum: 0, posts: 0 };
        t.sum += value;
        t.posts++;
        g.totals[metric] = t;
      }
    }
    groups.set(key, g);
  }
  return [...groups.values()].sort((a, b) => b.published - a.published || a.key.localeCompare(b.key));
}

/** The average of a metric over the posts that recorded it, or null. */
export function average(stats: GroupStats, metric: MetricKey): number | null {
  const t = stats.totals[metric];
  return t && t.posts ? t.sum / t.posts : null;
}

/** Reads a metrics form or JSON object: whole non-negative numbers for known keys only. */
export function parseMetrics(input: Record<string, unknown>): { metrics: Metrics } | { error: string } {
  const metrics: Metrics = {};
  for (const key of METRIC_KEYS) {
    const raw = input[key];
    if (raw === undefined || raw === null || String(raw).trim() === "") continue;
    const value = Number(String(raw).replace(/,/g, "").trim());
    if (!Number.isInteger(value) || value < 0) return { error: `${key.replace("_", " ")} must be a whole number.` };
    metrics[key] = value;
  }
  return Object.keys(metrics).length ? { metrics } : { error: "Enter at least one number." };
}
