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
