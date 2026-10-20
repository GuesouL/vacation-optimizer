import { describe, expect, it } from "vitest";

import { daysIn, monthsOf, ptoDays, takeOffNote } from "./breaks";

const weekdays = [0, 1, 2, 3, 4];

describe("ptoDays", () => {
  it("keeps workdays and drops weekends and holidays", () => {
    // Thanksgiving 2026 is Thu Nov 26; the break runs Thu-Sun.
    const holidays = new Map([["2026-11-26", "Thanksgiving"]]);
    expect(ptoDays("2026-11-26", "2026-11-29", weekdays, holidays)).toEqual(["2026-11-27"]);
  });

  it("follows your own work week", () => {
    expect(ptoDays("2026-11-27", "2026-11-29", [4, 5], new Map())).toEqual(["2026-11-27", "2026-11-28"]);
  });
});

describe("takeOffNote", () => {
  it("names one or two days and counts the rest as free", () => {
    expect(takeOffNote(4, ["2026-11-27"])).toBe("Take off Fri, Nov 27. 3 of the 4 days are already free.");
    expect(takeOffNote(4, ["2026-11-27", "2026-11-30"])).toBe(
      "Take off Fri, Nov 27 and Mon, Nov 30. 2 of the 4 days are already free.",
    );
  });

  it("counts longer stretches and handles free breaks", () => {
    expect(takeOffNote(9, ["a", "b", "c", "d"])).toBe("Take off 4 workdays. 5 of the 9 days are already free.");
    expect(takeOffNote(3, [])).toBe("No PTO needed: every day is already free.");
  });
});

describe("monthsOf and daysIn", () => {
  it("lists every month a break touches, across the new year", () => {
    expect(monthsOf("2026-12-24", "2027-01-03")).toEqual([{ year: 2026, month: 12 }, { year: 2027, month: 1 }]);
    expect(monthsOf("2026-11-26", "2026-11-29")).toEqual([{ year: 2026, month: 11 }]);
  });

  it("includes both ends", () => {
    expect(daysIn("2026-12-30", "2027-01-01")).toEqual(["2026-12-30", "2026-12-31", "2027-01-01"]);
  });
});
