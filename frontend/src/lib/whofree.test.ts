import { describe, expect, it } from "vitest";

import { groupByCost, whoIsFree } from "./whofree";

const suggested = { start: "2026-12-24", end: "2026-12-27" }; // Thu-Sun
const people = [
  { id: 1, name: "Gueso", kind: "ADULT" as const, mine: true, workWeek: [0, 1, 2, 3, 4] },
  { id: 2, name: "Cara", kind: "ADULT" as const, mine: true, workWeek: [0, 1, 2, 3, 4] },
  { id: 3, name: "Mia", kind: "CHILD" as const, mine: true },
  { id: 4, name: "Sam", kind: "ADULT" as const, mine: false },
];
const holidays = new Map([["2026-12-25", "Christmas Day"]]);

describe("whoIsFree", () => {
  it("clears everyone on the suggestion and notes the kid's school", () => {
    const rows = whoIsFree(suggested, { ...suggested, pto_cost: { Gueso: 1, Cara: 0, Sam: 2 } }, people, [], holidays);
    expect(rows.every((r) => r.ok)).toBe(true);
    expect(rows.map((r) => r.note)).toEqual(["1 PTO", "", "no school", "2 PTO"]);
  });

  it("checks the extra days against the people you manage", () => {
    const longer = { start: "2026-12-24", end: "2026-12-29" }; // adds Mon 28 and Tue 29
    const schedules = [
      { person_id: 1, items: [{ start_date: "2026-12-29", end_date: "2026-12-29", effect: "BUSY" as const }] },
      { person_id: 2, items: [] },
      { person_id: 3, items: [{ start_date: "2026-12-24", end_date: "2027-01-01", effect: "DAY_OFF" as const }] },
    ];
    const rows = whoIsFree(longer, suggested, people, schedules, holidays);
    expect(rows[0]).toMatchObject({ name: "Gueso", ok: false, note: "busy Tue, Dec 29" });
    expect(rows[1]).toMatchObject({ name: "Cara", ok: true, note: "3 PTO" }); // Thu 24, Mon 28, Tue 29; Christmas is a holiday
    expect(rows[2]).toMatchObject({ name: "Mia", ok: true, note: "no school" });
    expect(rows[3]).toMatchObject({ name: "Sam", ok: null }); // another family: we can't see their dates
  });

  it("flags a kid who has school on an extra weekday", () => {
    const longer = { start: "2026-12-24", end: "2026-12-28" };
    const schedules = [{ person_id: 3, items: [{ start_date: "2026-12-24", end_date: "2026-12-27", effect: "DAY_OFF" as const }] }];
    const mia = whoIsFree(longer, suggested, people, schedules, holidays).find((r) => r.name === "Mia");
    expect(mia).toMatchObject({ ok: false, note: "has school Mon, Dec 28" });
  });
});

describe("groupByCost", () => {
  it("groups in order by PTO cost and days off", () => {
    const w = (days: number, cost: number) => ({ days, pto_cost: { Gueso: cost, Cara: 0 } });
    const groups = groupByCost([w(4, 1), w(4, 1), w(3, 1), w(9, 2)]);
    expect(groups.map((g) => [g.label, g.windows.length])).toEqual([
      ["1 PTO day → 4 days off", 2],
      ["1 PTO day → 3 days off", 1],
      ["2 PTO days → 9 days off", 1],
    ]);
  });
});
