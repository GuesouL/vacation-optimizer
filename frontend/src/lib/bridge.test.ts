import { describe, expect, it } from "vitest";

import { thanksgiving, thanksgivingExample } from "./bridge";

describe("thanksgiving", () => {
  it("is the fourth Thursday of November", () => {
    expect(thanksgiving(2026)).toBe("2026-11-26");
    expect(thanksgiving(2027)).toBe("2027-11-25");
    expect(thanksgiving(2029)).toBe("2029-11-22"); // Nov 1 is a Thursday
    expect(thanksgiving(2030)).toBe("2030-11-28"); // latest possible
  });
});

describe("thanksgivingExample", () => {
  it("bridges the weekends with 4 PTO days for 9 days off", () => {
    const ex = thanksgivingExample("2026-10-22");
    expect(ex).toMatchObject({ year: 2026, start: "2026-11-21", end: "2026-11-29", ptoDays: 4, daysOff: 9 });
    const days = ex.weeks.flat();
    expect(days.filter((d) => d.kind === "pto").map((d) => d.date)).toEqual([
      "2026-11-23", "2026-11-24", "2026-11-25", "2026-11-27",
    ]);
    expect(days.filter((d) => d.kind === "pto" || d.kind === "holiday" || d.kind === "off")).toHaveLength(9);
  });

  it("lays out three Monday-first weeks around the break", () => {
    const weeks = thanksgivingExample("2026-10-22").weeks;
    expect(weeks.map((w) => w[0].date)).toEqual(["2026-11-16", "2026-11-23", "2026-11-30"]);
    expect(weeks[0][6]).toEqual({ date: "2026-11-22", kind: "off" }); // Sunday before, part of the break
    expect(weeks[2][5]).toEqual({ date: "2026-12-05", kind: "weekend" }); // after the break
  });

  it("keeps showing this year's until its last Sunday, then moves on", () => {
    expect(thanksgivingExample("2026-11-29").year).toBe(2026);
    expect(thanksgivingExample("2026-11-30").year).toBe(2027);
  });
});
