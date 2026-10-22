/**
 * The worked example on the signed-out home page: the next Thanksgiving bridge.
 *
 * Thanksgiving is always a Thursday, so taking Mon, Tue, Wed and Fri as PTO joins
 * the weekend before to the weekend after: 4 PTO days for 9 days off. Computing it
 * here (instead of hard-coding "2026") keeps the page correct every year with no
 * API call, so the home page stays static.
 */

import { addDays, weekday, type ISODate } from "./dates";

export type DayKind = "pto" | "holiday" | "off" | "weekend" | "work";

export type BridgeExample = {
  year: number;
  start: ISODate; // the Saturday before
  end: ISODate; // the Sunday after
  ptoDays: number;
  daysOff: number;
  /** Three Monday-first weeks around the break, like the app's calendar. */
  weeks: { date: ISODate; kind: DayKind }[][];
};

/** US Thanksgiving: the fourth Thursday of November. */
export function thanksgiving(year: number): ISODate {
  const nov1 = `${year}-11-01`;
  const firstThursday = (3 - weekday(nov1) + 7) % 7; // Thursday is 3 (Mon = 0)
  return addDays(nov1, firstThursday + 21);
}

/** The Thanksgiving bridge that hasn't ended yet as of `from`. */
export function thanksgivingExample(from: ISODate): BridgeExample {
  let year = Number(from.slice(0, 4));
  if (addDays(thanksgiving(year), 3) < from) year += 1; // this year's has passed
  const holiday = thanksgiving(year);
  const start = addDays(holiday, -5);
  const end = addDays(holiday, 3);
  const pto = new Set([-3, -2, -1, 1].map((n) => addDays(holiday, n)));

  const kind = (date: ISODate): DayKind => {
    if (date === holiday) return "holiday";
    if (pto.has(date)) return "pto";
    if (start <= date && date <= end) return "off";
    return weekday(date) >= 5 ? "weekend" : "work";
  };
  const firstMonday = addDays(holiday, -10); // the week holding the Saturday before
  const weeks = [0, 1, 2].map((w) =>
    Array.from({ length: 7 }, (_, d) => {
      const date = addDays(firstMonday, w * 7 + d);
      return { date, kind: kind(date) };
    }),
  );
  const daysOff = weeks.flat().filter((d) => start <= d.date && d.date <= end).length;
  return { year, start, end, ptoDays: pto.size, daysOff, weeks };
}
