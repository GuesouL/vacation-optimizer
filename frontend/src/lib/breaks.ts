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

/** Everything on one day, for the line under the calendar: "Thanksgiving · Selected break". */
export function describeDay(
  day: ISODate,
  ctx: {
    holidays: Map<ISODate, string>;
    workWeek: number[];
    selected: { start: ISODate; end: ISODate } | null;
    saved: { start_date: ISODate; end_date: ISODate }[];
    marks: Map<ISODate, { off: string[]; busy: string[] }>;
    picks?: { start: ISODate; end: ISODate }[];
  },
): string {
  const holiday = ctx.holidays.get(day);
  const workday = ctx.workWeek.includes(weekday(day)) && !holiday;
  const parts: string[] = holiday ? [holiday] : [];
  if (ctx.selected && ctx.selected.start <= day && day <= ctx.selected.end) {
    parts.push(workday ? "Selected break (your PTO day)" : "Selected break");
  } else if (ctx.saved.some((t) => t.start_date <= day && day <= t.end_date)) {
    parts.push(workday ? "Saved trip (your PTO day)" : "Saved trip");
  } else if (ctx.picks?.some((p) => p.start <= day && day <= p.end)) {
    parts.push("Part of a good pick");
  }
  const mark = ctx.marks.get(day);
  if (mark) parts.push(...mark.off, ...mark.busy);
  if (!parts.length) parts.push(workday ? "Nothing planned" : "Day off");
  return parts.join(" · ");
}

/** Why a break works, from what falls inside it: "Mia: Winter break (no school) + Christmas Day". */
export function whyText(
  start: ISODate,
  end: ISODate,
  holidays: Map<ISODate, string>,
  marks: Map<ISODate, { off: string[] }>,
): string | null {
  const reasons = new Set<string>();
  for (const d of daysIn(start, end)) {
    for (const off of marks.get(d)?.off ?? []) reasons.add(off);
    const holiday = holidays.get(d);
    if (holiday) reasons.add(holiday);
  }
  return reasons.size ? [...reasons].slice(0, 2).join(" + ") : null;
}

type Range = { start: ISODate; end: ISODate };

/** Longest trip the API saves (TripIn.not_too_long). */
export const MAX_TRIP_DAYS = 31;

/**
 * Stretch or trim a suggested break by tapping a day. A day before the break
 * moves its start back, a day after moves its end out, and tapping its first or
 * last day trims that end by one, but never smaller than the suggestion itself
 * and never before `earliest` (today) or past 31 days. Returns the range unchanged
 * when the tap can't apply.
 */
export function stretchTo(range: Range, day: ISODate, suggested: Range, earliest: ISODate): Range {
  let next = range;
  if (day < range.start) next = { ...range, start: day };
  else if (day > range.end) next = { ...range, end: day };
  else if (day === range.start && day < suggested.start) next = { ...range, start: addDays(day, 1) };
  else if (day === range.end && day > suggested.end) next = { ...range, end: addDays(day, -1) };
  if (next.start < earliest || daysIn(next.start, next.end).length > MAX_TRIP_DAYS) return range;
  return next;
}
