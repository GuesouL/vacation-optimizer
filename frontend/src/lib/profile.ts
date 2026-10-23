import { api, FEDERAL_CALENDAR_ID, type Me } from "./api";
import { companyCalendarId } from "./holidays";

export type Renewal = { allowance: number; month: number; day: number; carryoverMax: number };

export type Profile = {
  name: string;
  ptoBalance: number;
  workWeek: number[];
  skippedHolidays: string[]; // federal holidays their job doesn't give; [] = all of them
  skippedCompanyDays: string[] | null; // common company days they don't get; null = leave as saved
  renewal: Renewal | null; // null: plan the whole year with today's balance
};

/** What `PUT /people/{id}` takes. Leaving the renewal out clears it on the server. */
export function updateBody(profile: Profile) {
  return {
    name: profile.name,
    pto_balance: profile.ptoBalance,
    work_week: profile.workWeek,
    ...(profile.renewal && {
      pto_allowance: profile.renewal.allowance,
      pto_renews_on: { month: profile.renewal.month, day: profile.renewal.day },
      pto_carryover_max: profile.renewal.carryoverMax,
    }),
  };
}

/** The header line: days left, and why it differs from the balance you typed. */
export function describePtoLeft(left: number, balance: number | null): string {
  const days = `${left} PTO ${left === 1 ? "day" : "days"} left`;
  return balance != null && left !== balance ? `${days} after booked trips` : days;
}

/**
 * Your own person record, created once. If an earlier try stopped halfway,
 * the existing one is reused instead of failing with "already exists".
 */
export async function ensureSelf(me: Me, profile: Profile): Promise<number> {
  if (me.self_person_id != null) return me.self_person_id;
  return createAdult(profile, true);
}

/**
 * Create an adult you manage and put them on the federal holiday calendar, minus
 * the holidays their job skips. `isSelf` links the record to your account (once only).
 */
export async function createAdult(profile: Profile, isSelf: boolean): Promise<number> {
  const person = await api.POST("/people", {
    body: {
      name: profile.name,
      kind: "ADULT",
      pto_balance: profile.ptoBalance,
      work_week: profile.workWeek,
      is_self: isSelf,
      ...(profile.renewal && {
        pto_allowance: profile.renewal.allowance,
        pto_renews_on: { month: profile.renewal.month, day: profile.renewal.day },
        pto_carryover_max: profile.renewal.carryoverMax,
      }),
    },
  });
  if (!person.data) throw person.error;
  await saveHolidays(person.data.id, profile);
  return person.data.id;
}

/** Save which federal holidays and company days someone skips. Posting again replaces each list. */
export async function saveHolidays(personId: number, profile: Pick<Profile, "skippedHolidays" | "skippedCompanyDays">) {
  const links = [{ calendar_id: FEDERAL_CALENDAR_ID, excluded_titles: profile.skippedHolidays }];
  if (profile.skippedCompanyDays) {
    links.push({ calendar_id: await companyCalendarId(), excluded_titles: profile.skippedCompanyDays });
  }
  for (const body of links) {
    const link = await api.POST("/people/{person_id}/calendars", { params: { path: { person_id: personId } }, body });
    if (link.error) throw link.error;
  }
}

/** Who Settings edits: the adult named in `?person=` if you manage them, otherwise you. */
export function settingsTarget(me: Me, requested: string | null) {
  const adults = me.people.filter((p) => p.kind === "ADULT");
  const wanted = requested == null ? undefined : adults.find((p) => p.id === Number(requested));
  return wanted ?? adults.find((p) => p.id === me.self_person_id);
}
