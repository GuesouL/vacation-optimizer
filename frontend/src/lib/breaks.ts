import { addDays, formatDate, type ISODate, weekday } from "./dates";

/** Every day from start to end, inclusive. */
export function daysIn(start: ISODate, end: ISODate): ISODate[] {
  const days: ISODate[] = [];
  for (let d = start; d <= end; d = addDays(d, 1)) days.push(d);
  return days;
}

/** The days in a break you'd have to take off: your workdays that aren't holidays. */
export function ptoDays(start: ISODate, end: ISODate, workWeek: number[], holidays: Map<ISODate, string>): ISODate[] {
  return daysIn(start, end).filter((d) => workWeek.includes(weekday(d)) && !holidays.has(d));
}

/** "Take off Thu, Nov 26. 3 of the 4 days are already free." */
export function takeOffNote(days: number, pto: ISODate[]): string {
  const free = days - pto.length;
  const freeNote = `${free} of the ${days} days ${free === 1 ? "is" : "are"} already free.`;
  if (pto.length === 0) return "No PTO needed: every day is already free.";
  const which = pto.length <= 2 ? pto.map(formatDate).join(" and ") : `${pto.length} workdays`;
  return `Take off ${which}. ${freeNote}`;
}

/** The first day of each month a break touches, so its detail can show those months. */
export function monthsOf(start: ISODate, end: ISODate): { year: number; month: number }[] {
  const months: { year: number; month: number }[] = [];
  for (let y = Number(start.slice(0, 4)), m = Number(start.slice(5, 7)); ; m++) {
    if (m > 12) { m = 1; y++; }
    months.push({ year: y, month: m });
    if (`${y}-${String(m).padStart(2, "0")}` >= end.slice(0, 7)) return months;
  }
}
