// Calendar-date helpers. Slots are calendar dates in the founder's own time
// zone ("2026-11-03"), not instants, so all arithmetic here is on plain
// ISO dates using UTC internally (no daylight-saving effects).

export type IsoDate = string; // YYYY-MM-DD
export type IsoMonth = string; // YYYY-MM

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const MONTH = /^\d{4}-\d{2}$/;

export function isIsoDate(value: string): value is IsoDate {
  if (!DATE.test(value)) return false;
  return toUtc(value).toISOString().slice(0, 10) === value;
}

export function isIsoMonth(value: string): value is IsoMonth {
  if (!MONTH.test(value)) return false;
  const month = Number(value.slice(5, 7));
  return month >= 1 && month <= 12;
}

function toUtc(date: IsoDate): Date {
  return new Date(`${date}T00:00:00Z`);
}

function fromUtc(date: Date): IsoDate {
  return date.toISOString().slice(0, 10);
}

export function addDays(date: IsoDate, days: number): IsoDate {
  const d = toUtc(date);
  d.setUTCDate(d.getUTCDate() + days);
  return fromUtc(d);
}

/** ISO weekday: Monday = 1 … Sunday = 7. */
export function isoWeekday(date: IsoDate): number {
  const day = toUtc(date).getUTCDay();
  return day === 0 ? 7 : day;
}

/** The Monday of the ISO week containing `date`. */
export function startOfIsoWeek(date: IsoDate): IsoDate {
  return addDays(date, 1 - isoWeekday(date));
}

/** ISO-8601 week number (weeks start Monday; week 1 contains the first Thursday). */
export function isoWeekNumber(date: IsoDate): number {
  const thursday = addDays(date, 4 - isoWeekday(date));
  const yearStart = `${thursday.slice(0, 4)}-01-01`;
  const dayOfYear = (toUtc(thursday).getTime() - toUtc(yearStart).getTime()) / 86_400_000;
  return Math.floor(dayOfYear / 7) + 1;
}

export function monthOf(date: IsoDate): IsoMonth {
  return date.slice(0, 7);
}

export function firstDayOfMonth(month: IsoMonth): IsoDate {
  return `${month}-01`;
}

export function lastDayOfMonth(month: IsoMonth): IsoDate {
  const [year, m] = month.split("-").map(Number);
  return fromUtc(new Date(Date.UTC(year, m, 0)));
}

export function daysInMonth(month: IsoMonth): number {
  return Number(lastDayOfMonth(month).slice(8, 10));
}

export function addMonths(month: IsoMonth, count: number): IsoMonth {
  const [year, m] = month.split("-").map(Number);
  const d = new Date(Date.UTC(year, m - 1 + count, 1));
  return d.toISOString().slice(0, 7);
}

/** Whole days from `from` to `to` (negative if `to` is earlier). */
export function daysBetween(from: IsoDate, to: IsoDate): number {
  return Math.round((toUtc(to).getTime() - toUtc(from).getTime()) / 86_400_000);
}

/** Every date from `from` to `to`, inclusive. */
export function eachDay(from: IsoDate, to: IsoDate): IsoDate[] {
  const days: IsoDate[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) days.push(d);
  return days;
}

/** Today's calendar date in an IANA time zone. */
export function localToday(timeZone: string, now: Date = new Date()): IsoDate {
  // en-CA formats as YYYY-MM-DD.
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

export const WEEKDAY_NAMES = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;

/** "November 2026" */
export function monthLabel(month: IsoMonth): string {
  return new Date(`${month}-01T00:00:00Z`).toLocaleDateString("en-US", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}

/** "Tue, Nov 3" */
export function shortDateLabel(date: IsoDate): string {
  return new Date(`${date}T00:00:00Z`).toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

/** "2026-11-03T09:30" in a time zone, as wall-clock fields. */
export function localDateTime(timeZone: string, at: Date): string {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(at)
      .map((p) => [p.type, p.value]),
  );
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;
}

/**
 * The instant at which a time zone's clock reads `local` ("2026-11-03T09:30"),
 * or null if the text isn't such a time. In a daylight-saving gap the clock
 * skips, the later reading is used; in an overlap, the earlier instant.
 */
export function zonedToUtc(local: string, timeZone: string): Date | null {
  const m = local.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/);
  if (!m) return null;
  const asUtc = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]);
  if (new Date(asUtc).toISOString().slice(0, 16) !== local) return null;
  // The zone's offset at a guess, corrected once for a change of offset in between.
  const offsetAt = (t: number) => {
    const shown = localDateTime(timeZone, new Date(t));
    const [d, h] = shown.split("T");
    const [y, mo, da] = d.split("-").map(Number);
    const [hh, mm] = h.split(":").map(Number);
    return Date.UTC(y, mo - 1, da, hh, mm) - t;
  };
  let t = asUtc - offsetAt(asUtc);
  t = asUtc - offsetAt(t);
  const shown = (x: number) => localDateTime(timeZone, new Date(x));
  const candidates = [t, asUtc - offsetAt(t - 3 * 3_600_000), asUtc - offsetAt(t + 3 * 3_600_000)];
  const exact = candidates.filter((x) => shown(x) === local).sort((a, b) => a - b);
  if (exact.length) return new Date(exact[0]);
  // A time skipped by the clock: the first reading after it.
  const after = candidates.filter((x) => shown(x) > local).sort((a, b) => a - b);
  return new Date(after[0] ?? t);
}
