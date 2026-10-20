import { describe, expect, it } from "vitest";

import { dayFill, monthFill } from "./calendar";

const base = { holidays: new Map([["2026-11-26", "Thanksgiving"]]), workWeek: [0, 1, 2, 3, 4], selected: null, saved: [], picks: [] };
const thanksgiving = { start_date: "2026-11-26", end_date: "2026-11-29" };

describe("dayFill", () => {
  it("splits a saved trip into PTO days and free days", () => {
    const ctx = { ...base, saved: [thanksgiving] };
    expect(dayFill("2026-11-27", ctx)).toBe("pto"); // Friday: a workday
    expect(dayFill("2026-11-26", ctx)).toBe("trip"); // the holiday itself
    expect(dayFill("2026-11-28", ctx)).toBe("trip"); // Saturday
  });

  it("treats the selected break like a trip", () => {
    expect(dayFill("2026-11-27", { ...base, selected: { start: "2026-11-26", end: "2026-11-29" } })).toBe("pto");
  });

  it("tints good picks and shades weekends, but not lone holidays", () => {
    const ctx = { ...base, picks: [{ start: "2026-12-24", end: "2027-01-03" }] };
    expect(dayFill("2026-12-28", ctx)).toBe("pick");
    expect(dayFill("2026-11-21", ctx)).toBe("off"); // Saturday
    expect(dayFill("2026-11-26", ctx)).toBeNull(); // Thanksgiving: a dot, no fill
    expect(dayFill("2026-11-24", ctx)).toBeNull();
  });
});

describe("monthFill", () => {
  it("prefers a trip over a pick", () => {
    expect(monthFill(2026, 11, [thanksgiving], [{ start: "2026-11-05", end: "2026-11-08" }])).toBe("trip");
  });

  it("marks a pick only in the month it starts", () => {
    const picks = [{ start: "2026-12-24", end: "2027-01-03" }];
    expect(monthFill(2026, 12, [], picks)).toBe("pick");
    expect(monthFill(2027, 1, [], picks)).toBeNull();
  });

  it("marks every month a trip touches", () => {
    const trip = { start_date: "2026-12-30", end_date: "2027-01-02" };
    expect(monthFill(2026, 12, [trip], [])).toBe("trip");
    expect(monthFill(2027, 1, [trip], [])).toBe("trip");
  });
});
