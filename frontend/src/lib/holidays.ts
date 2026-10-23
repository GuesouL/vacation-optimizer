import { useEffect, useState } from "react";

import type { components } from "./api-types";
import { api, type CalendarInfo, type Holiday } from "./api";
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

type Kind = components["schemas"]["CalendarKind"];

/**
 * What someone skips on one of the computed calendars (FEDERAL or COMPANY),
 * from their calendar links. `null` means they aren't on that calendar at all,
 * which is the same as skipping every day on it.
 */
export function skipsOn(links: CalendarInfo[], kind: Kind): string[] | null {
  return links.find((l) => l.kind === kind && l.enabled)?.excluded_titles ?? null;
}

export const federalSkips = (links: CalendarInfo[]) => skipsOn(links, "FEDERAL");

/** The company days someone gets: the opposite of what's stored. */
export function companyPicks(skipped: string[] | null, names: string[]): string[] {
  return skipped === null ? [] : names.filter((n) => !skipped.includes(n));
}

/** Drop the holidays this person works from a date -> name map. */
export function holidaysYouGet(all: Map<ISODate, string>, skipped: string[] | null): Map<ISODate, string> {
  if (skipped === null) return new Map();
  return new Map([...all].filter(([, name]) => !skipped.includes(name)));
}

/** One year of federal holidays or common company days. */
export async function holidaysIn(kind: "federal" | "company", year: number): Promise<Holiday[]> {
  const params = { params: { path: { year } } };
  const { data, error } = kind === "federal"
    ? await api.GET("/holidays/{year}", params)
    : await api.GET("/company-days/{year}", params);
  if (!data) throw error;
  return data;
}

/** The federal holidays or common company days, each on its next date. Empty until loaded. */
export function useHolidays(kind: "federal" | "company"): Holiday[] {
  const [list, setList] = useState<Holiday[]>([]);
  useEffect(() => {
    const from = today();
    const year = Number(from.slice(0, 4));
    Promise.all([year, year + 1].map((y) => holidaysIn(kind, y)))
      .then((years) => setList(upcoming(years, from)))
      .catch(() => setList([])); // the picker says it couldn't load; the toggle still works
  }, [kind]);
  return list;
}

/** The shared "Common company days" calendar. It's found by kind: its id differs per database. */
export async function companyCalendarId(): Promise<number> {
  const { data, error } = await api.GET("/calendars", { params: { query: { kind: "COMPANY" } } });
  if (!data?.[0]) throw error ?? new Error("The company days calendar is missing. Run the database migrations.");
  return data[0].id;
}
