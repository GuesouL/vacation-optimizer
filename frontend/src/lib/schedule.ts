/** Helpers for entering schedules: what to offer, what to check, what to save. */
import type { EventDraft, IcsPreview } from "./api";
import { addDays, type ISODate } from "./dates";

export type Effect = EventDraft["effect"];
export type CalendarKind = "SCHOOL" | "WORK" | "LEAGUE" | "CUSTOM";

/** What kind of calendar to offer, depending on who it's for. */
export function kindsFor(person: "ADULT" | "CHILD" | "GUEST"): { kind: CalendarKind; label: string }[] {
  const sports = { kind: "LEAGUE", label: "Sports or activities" } as const;
  return person === "CHILD"
    ? [{ kind: "SCHOOL", label: "School calendar" }, sports]
    : [{ kind: "WORK", label: "Work blackout dates" }, sports, { kind: "CUSTOM", label: "Personal obligations" }];
}

/** DAY_OFF means a free day (a school break); BUSY means a day they can't go. */
export function effectLabel(effect: Effect, kind: CalendarKind): string {
  if (effect === "BUSY") return "Busy";
  return kind === "SCHOOL" ? "No school" : "Day off";
}

/** Summer is a break too: from the day after the last day of school to the day before the next first day. */
export function summerBreak(lastDay: ISODate, nextFirstDay: ISODate): EventDraft | null {
  const start = addDays(lastDay, 1);
  const end = addDays(nextFirstDay, -1);
  return start <= end ? { title: "Summer break", start_date: start, end_date: end, effect: "DAY_OFF" } : null;
}

/** Why a typed-in range can't be saved, or null if it's fine. */
export function rangeProblem(title: string, start: ISODate, end: ISODate): string | null {
  if (!title.trim()) return "Give it a name";
  if (!start || !end) return "Pick the first and last day";
  if (end < start) return "The last day can't be before the first day";
  return null;
}

/** One row of an imported file in the review list. */
export type Row = IcsPreview["events"][number] & { checked: boolean };

export function toRows(preview: IcsPreview): Row[] {
  return preview.events.map((e) => ({ ...e, checked: e.selected }));
}

/** Only the ticked rows get saved, with the effect the user chose. */
export function toDrafts(rows: Row[]): EventDraft[] {
  return rows
    .filter((r) => r.checked)
    .map((r) => ({ title: r.title, start_date: r.start_date, end_date: r.end_date, effect: r.effect }));
}

/** What was left out of an import, in a sentence ("" if nothing). */
export function skippedNote(p: Pick<IcsPreview, "skipped_recurring" | "skipped_too_long" | "skipped_invalid" | "truncated">): string {
  const parts = [];
  if (p.skipped_recurring) parts.push(`${p.skipped_recurring} repeating ${p.skipped_recurring === 1 ? "event" : "events"} (like weekly practices)`);
  if (p.skipped_too_long) parts.push(`${p.skipped_too_long} that last over a year`);
  if (p.skipped_invalid) parts.push(`${p.skipped_invalid} we couldn't read`);
  if (p.truncated) parts.push("everything after the first 500");
  return parts.length ? `Left out: ${parts.join(", ")}.` : "";
}
