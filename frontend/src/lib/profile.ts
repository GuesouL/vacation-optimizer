import { api, FEDERAL_CALENDAR_ID, type Me } from "./api";

export type Renewal = { allowance: number; month: number; day: number; carryoverMax: number };

export type Profile = {
  name: string;
  ptoBalance: number;
  workWeek: number[];
  federal: boolean;
  renewal: Renewal | null; // null: plan the whole year with today's balance
};

/**
 * Your own person record, created once. If an earlier try stopped halfway,
 * the existing one is reused instead of failing with "already exists".
 */
export async function ensureSelf(me: Me, profile: Profile): Promise<number> {
  if (me.self_person_id != null) return me.self_person_id;
  const person = await api.POST("/people", {
    body: {
      name: profile.name,
      kind: "ADULT",
      pto_balance: profile.ptoBalance,
      work_week: profile.workWeek,
      is_self: true,
      ...(profile.renewal && {
        pto_allowance: profile.renewal.allowance,
        pto_renews_on: { month: profile.renewal.month, day: profile.renewal.day },
        pto_carryover_max: profile.renewal.carryoverMax,
      }),
    },
  });
  if (!person.data) throw person.error;
  if (profile.federal) {
    const link = await api.POST("/people/{person_id}/calendars", {
      params: { path: { person_id: person.data.id } },
      body: { calendar_id: FEDERAL_CALENDAR_ID },
    });
    if (link.error) throw link.error;
  }
  return person.data.id;
}
