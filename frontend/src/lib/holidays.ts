import { useEffect, useState } from "react";

import { api, FEDERAL_CALENDAR_ID, type CalendarInfo, type Holiday } from "./api";
import { type ISODate, today } from "./dates";

/**
 * Which federal holidays someone's job gives them. The server stores the ones
 * they *skip* (exclusions on their link to the federal calendar), because most
 * people get all of them and an empty list is the common case.
 */

// The six most private employers give. A preset only ticks boxes: we save the
// resulting list, never the preset's name, so changing this later can't quietly
// change anyone's saved choice.
export const BIG_SIX = [
  "New Year's Day",
  "Memorial Day",
  "Independence Day",
  "Labor Day",
  "Thanksgiving",
  "Christmas Day",
];

export type Preset = "all" | "big6" | "none";

export const PRESETS: { id: Preset; label: string }[] = [
  { id: "all", label: "All of them" },
  { id: "big6", label: "Big 6 (most companies)" },
  { id: "none", label: "None" },
];

/** The holidays a preset leaves out, from the full list of names. */
export function skippedFor(preset: Preset, names: string[]): string[] {
  if (preset === "all") return [];
  if (preset === "none") return [...names];
  return names.filter((n) => !BIG_SIX.includes(n));
}

/** The preset that matches a list of skips exactly, if any (so its chip lights up). */
export function presetOf(skipped: string[], names: string[]): Preset | null {
  const same = (a: string[], b: string[]) => a.length === b.length && a.every((n) => b.includes(n));
  return PRESETS.find((p) => same(skippedFor(p.id, names), skipped))?.id ?? null;
}

/**
 * Each holiday once, on its next date from `from`, in calendar order. The API
 * lists a year at a time and a year can hold two New Year's Days (one observed
 * the Dec 31 before), so the list is de-duplicated by name.
 */
export function upcoming(lists: Holiday[][], from: ISODate): Holiday[] {
  const [thisYear = [], nextYear = []] = lists;
  const names = [...new Set(thisYear.map((h) => h.name))];
  return names.map((name) => {
    const next = [...thisYear, ...nextYear].find((h) => h.name === name && h.date >= from);
    return next ?? thisYear.find((h) => h.name === name)!;
  });
}

/**
 * What someone skips, from their calendar links. `null` means they aren't on
 * the federal calendar at all, which is the same as skipping every holiday.
 */
export function federalSkips(links: CalendarInfo[]): string[] | null {
  return links.find((l) => l.id === FEDERAL_CALENDAR_ID && l.enabled)?.excluded_titles ?? null;
}

/** Drop the holidays this person works from a date -> name map. */
export function holidaysYouGet(all: Map<ISODate, string>, skipped: string[] | null): Map<ISODate, string> {
  if (skipped === null) return new Map();
  return new Map([...all].filter(([, name]) => !skipped.includes(name)));
}

/** The federal holidays, each on its next date. Empty until loaded. */
export function useFederalHolidays(): Holiday[] {
  const [list, setList] = useState<Holiday[]>([]);
  useEffect(() => {
    const from = today();
    const year = Number(from.slice(0, 4));
    Promise.all(
      [year, year + 1].map((y) => api.GET("/holidays/{year}", { params: { path: { year: y } } })),
    )
      .then((responses) => setList(upcoming(responses.map((r) => r.data ?? []), from)))
      .catch(() => setList([])); // the picker says it couldn't load; the toggle still works
  }, []);
  return list;
}
