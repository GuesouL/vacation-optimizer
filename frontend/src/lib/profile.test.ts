import { describe, expect, it } from "vitest";

import { describePtoLeft, settingsTarget, updateBody } from "./profile";

const base = { name: "Pat", ptoBalance: 7, workWeek: [0, 1, 2, 3], federal: true, renewal: null };

describe("updateBody", () => {
  it("leaves the renewal out when there is none, so the server clears it", () => {
    expect(updateBody(base)).toEqual({ name: "Pat", pto_balance: 7, work_week: [0, 1, 2, 3] });
  });

  it("sends the renewal as a month and day", () => {
    const body = updateBody({ ...base, renewal: { allowance: 20, month: 3, day: 15, carryoverMax: 5 } });
    expect(body).toMatchObject({
      pto_allowance: 20,
      pto_renews_on: { month: 3, day: 15 },
      pto_carryover_max: 5,
    });
  });
});

describe("describePtoLeft", () => {
  it("says nothing extra when no trip is booked", () => {
    expect(describePtoLeft(10, 10)).toBe("10 PTO days left");
  });

  it("explains the difference after a booking", () => {
    expect(describePtoLeft(6, 10)).toBe("6 PTO days left after booked trips");
  });

  it("uses the singular for one day", () => {
    expect(describePtoLeft(1, 1)).toBe("1 PTO day left");
  });
});

describe("settingsTarget", () => {
  const person = (id: number, kind: "ADULT" | "CHILD") => ({ id, kind });
  const me = {
    self_person_id: 1,
    people: [person(1, "ADULT"), person(2, "ADULT"), person(3, "CHILD")],
  } as unknown as Parameters<typeof settingsTarget>[0];

  it("defaults to you", () => {
    expect(settingsTarget(me, null)?.id).toBe(1);
  });

  it("opens an adult you manage", () => {
    expect(settingsTarget(me, "2")?.id).toBe(2);
  });

  it("falls back to you for a child, a stranger or junk", () => {
    expect(settingsTarget(me, "3")?.id).toBe(1);
    expect(settingsTarget(me, "99")?.id).toBe(1);
    expect(settingsTarget(me, "abc")?.id).toBe(1);
  });
});
