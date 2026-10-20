import { isBetween, type ISODate, weekday } from "./dates";

type Range = { start: ISODate; end: ISODate };
type SavedTrip = { start_date: ISODate; end_date: ISODate };

/**
 * How one calendar day is filled, using the mockup's rules:
 * a trip day you'd spend PTO on is "pto", the rest of a trip is "trip",
 * a day inside a good pick you haven't saved is "pick", other days off are "off".
 * The selected break counts as a trip so its PTO days stand out.
 */
export type DayFill = "pto" | "trip" | "pick" | "off" | null;

export function dayFill(
  day: ISODate,
  ctx: {
    holidays: Map<ISODate, string>;
    workWeek: number[];
    selected: Range | null;
    saved: SavedTrip[];
    picks: Range[];
  },
): DayFill {
  const workday = ctx.workWeek.includes(weekday(day)) && !ctx.holidays.has(day);
  const inTrip =
    (ctx.selected != null && isBetween(day, ctx.selected.start, ctx.selected.end)) ||
    ctx.saved.some((t) => isBetween(day, t.start_date, t.end_date));
  if (inTrip) return workday ? "pto" : "trip";
  if (ctx.picks.some((p) => isBetween(day, p.start, p.end))) return "pick";
  // Holidays keep their dot instead of a fill, like the mockup.
  if (!ctx.workWeek.includes(weekday(day))) return "off";
  return null;
}

/** A ribbon month: "trip" if a saved trip touches it, "pick" if an unsaved good pick starts in it. */
export function monthFill(year: number, month: number, saved: SavedTrip[], picks: Range[]): "trip" | "pick" | null {
  const first = `${year}-${String(month).padStart(2, "0")}-01`;
  const last = `${year}-${String(month).padStart(2, "0")}-31`; // string compare, so 31 is safe for every month
  if (saved.some((t) => t.start_date <= last && t.end_date >= first)) return "trip";
  if (picks.some((p) => p.start >= first && p.start <= last)) return "pick";
  return null;
}
