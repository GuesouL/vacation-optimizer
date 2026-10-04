/**
 * Plain calendar dates as "YYYY-MM-DD" strings.
 *
 * We never turn these into JavaScript `Date` objects in local time:
 * `new Date("2026-11-26")` means midnight UTC, which is still Nov 25 in
 * California. All the math below runs in UTC, so a day can't shift.
 */

export type ISODate = string;

const DAY_MS = 24 * 60 * 60 * 1000;

function toUTC(iso: ISODate): number {
  const [year, month, day] = iso.split("-").map(Number);
  return Date.UTC(year, month - 1, day);
}

function fromUTC(ms: number): ISODate {
  return new Date(ms).toISOString().slice(0, 10);
}

/** Today's date where the user is, as a plain date. */
export function today(now: Date = new Date()): ISODate {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

export function addDays(iso: ISODate, days: number): ISODate {
  return fromUTC(toUTC(iso) + days * DAY_MS);
}

/** 0 = Monday ... 6 = Sunday, matching Python's date.weekday(). */
export function weekday(iso: ISODate): number {
  return (new Date(toUTC(iso)).getUTCDay() + 6) % 7;
}

export function isBetween(iso: ISODate, start: ISODate, end: ISODate): boolean {
  return start <= iso && iso <= end; // "YYYY-MM-DD" strings sort like dates
}

/**
 * One month as calendar rows, Monday first. Blank cells are null.
 * month is 1-12.
 */
export function monthGrid(year: number, month: number): (ISODate | null)[][] {
  const first = fromUTC(Date.UTC(year, month - 1, 1));
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const cells: (ISODate | null)[] = Array(weekday(first)).fill(null);
  for (let day = 0; day < daysInMonth; day++) cells.push(addDays(first, day));
  while (cells.length % 7) cells.push(null);
  const rows = [];
  for (let i = 0; i < cells.length; i += 7) rows.push(cells.slice(i, i + 7));
  return rows;
}

/** The 12 (year, month) pairs starting from the month of `start`. */
export function next12Months(start: ISODate): { year: number; month: number }[] {
  const [year, month] = start.split("-").map(Number);
  return Array.from({ length: 12 }, (_, i) => ({
    year: year + Math.floor((month - 1 + i) / 12),
    month: ((month - 1 + i) % 12) + 1,
  }));
}

const formatter = new Intl.DateTimeFormat("en-US", {
  weekday: "short",
  month: "short",
  day: "numeric",
  timeZone: "UTC", // format the UTC instant we built, so the day never shifts
});

export function formatDate(iso: ISODate): string {
  return formatter.format(new Date(toUTC(iso)));
}

export function formatRange(start: ISODate, end: ISODate): string {
  const endYear = end.slice(0, 4);
  const sameYear = start.slice(0, 4) === endYear;
  return `${formatDate(start)} – ${formatDate(end)}${sameYear ? "" : `, ${endYear}`}`;
}
