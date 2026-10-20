import { daysIn } from "./breaks";
import { formatDate, type ISODate, weekday } from "./dates";

type Range = { start: ISODate; end: ISODate };
type Person = { name: string; kind: "ADULT" | "CHILD" | "GUEST"; mine: boolean; workWeek?: number[] | null };
type Schedule = { person_id: number; items: { start_date: ISODate; end_date: ISODate; effect: "DAY_OFF" | "BUSY" }[] };

/** One line of "Who's free": ok = free, false = a conflict, null = we can't see their dates. */
export type WhoRow = { name: string; ok: boolean | null; note: string };

const isWeekday = (day: ISODate) => weekday(day) < 5;
const inItem = (day: ISODate, i: { start_date: ISODate; end_date: ISODate }) => i.start_date <= day && day <= i.end_date;

const pto = (n: number) => (n > 0 ? `${n} PTO` : "");

/**
 * Who can take this trip. A suggested break already fits everyone (the search only
 * returns breaks nobody is blocked on), so everyone is free. When you stretch it, the
 * extra days are checked against the schedules of the people you manage: a busy day
 * is a conflict, and a kid needs school off on every extra weekday. People from other
 * families have private schedules, so for them the extra days are "not checked".
 */
export function whoIsFree(
  range: Range,
  suggested: Range & { pto_cost?: Record<string, number> },
  people: (Person & { id: number })[],
  schedules: Schedule[],
  holidays: Map<ISODate, string>,
): WhoRow[] {
  const extra = daysIn(range.start, range.end).filter((d) => d < suggested.start || d > suggested.end);
  const schoolDays = (days: ISODate[]) => days.filter((d) => isWeekday(d) && !holidays.has(d));

  return people.map((p) => {
    const kid = p.kind === "CHILD";
    const noSchool = kid && schoolDays(daysIn(range.start, range.end)).length > 0 ? "no school" : "";
    // What they spend: the search's number for the suggestion; for your adults, their own work week otherwise.
    const spend = (schedule?: Schedule) => {
      if (p.kind !== "ADULT") return noSchool;
      if (extra.length === 0) return pto(suggested.pto_cost?.[p.name] ?? 0);
      if (!p.workWeek) return "";
      const off = (d: ISODate) => holidays.has(d) || !!schedule?.items.some((i) => i.effect === "DAY_OFF" && inItem(d, i));
      return pto(daysIn(range.start, range.end).filter((d) => p.workWeek!.includes(weekday(d)) && !off(d)).length);
    };
    if (extra.length === 0) return { name: p.name, ok: true, note: spend() };

    const schedule = p.mine ? schedules.find((s) => s.person_id === p.id) : undefined;
    if (!schedule) return { name: p.name, ok: null, note: "extra days not checked" };

    const busy = extra.find((d) => schedule.items.some((i) => i.effect === "BUSY" && inItem(d, i)));
    if (busy) return { name: p.name, ok: false, note: `busy ${formatDate(busy)}` };
    if (kid) {
      const school = schoolDays(extra).find((d) => !schedule.items.some((i) => i.effect === "DAY_OFF" && inItem(d, i)));
      if (school) return { name: p.name, ok: false, note: `has school ${formatDate(school)}` };
    }
    return { name: p.name, ok: true, note: spend(schedule) };
  });
}

/** Suggestions grouped under "1 PTO day → 4 days off", so that line isn't repeated on every row. */
export function groupByCost<W extends { days: number; pto_cost: Record<string, number> }>(
  windows: W[],
): { label: string; windows: W[] }[] {
  const groups = new Map<string, W[]>();
  for (const w of windows) {
    const cost = Math.max(0, ...Object.values(w.pto_cost));
    const label = `${cost} PTO ${cost === 1 ? "day" : "days"} → ${w.days} days off`;
    groups.set(label, [...(groups.get(label) ?? []), w]);
  }
  return [...groups].map(([label, ws]) => ({ label, windows: ws }));
}
