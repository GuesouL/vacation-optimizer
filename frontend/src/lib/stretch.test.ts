import { describe, expect, it } from "vitest";

import type { Window } from "./api";
import { soonest, stretch } from "./stretch";

const w = (start: string, end: string, days: number, pto_cost: Record<string, number>): Window => ({
  start, end, days, pto_cost, score: null,
});

describe("stretch", () => {
  const thanksgiving = w("2026-11-26", "2026-11-29", 4, { Pat: 1 }); // 4.0x
  const christmas = w("2026-12-19", "2027-01-03", 16, { Pat: 7 }); // 2.3x
  const spring = w("2027-03-27", "2027-04-04", 9, { Pat: 4 }); // 2.25x

  it("takes the best value first and stops at the budget", () => {
    const s = stretch([spring, christmas, thanksgiving], 9);
    expect(s.picks).toEqual([thanksgiving, christmas]); // spring no longer fits
    expect(s).toMatchObject({ used: 8, daysOff: 20 });
  });

  it("skips a break that overlaps one already taken", () => {
    const overlap = w("2026-11-27", "2026-11-30", 4, { Pat: 2 });
    expect(stretch([thanksgiving, overlap], 10).picks).toEqual([thanksgiving]);
  });

  it("counts the person who spends the most in a group", () => {
    const s = stretch([w("2026-11-26", "2026-11-29", 4, { Pat: 1, Lee: 2 })], 1);
    expect(s.picks).toEqual([]);
  });

  it("ignores free breaks and handles no PTO", () => {
    expect(stretch([w("2026-11-26", "2026-11-29", 4, { Pat: 0 })], 5).daysOff).toBe(0);
    expect(stretch([thanksgiving], 0).picks).toEqual([]);
  });
});

describe("soonest", () => {
  it("sorts by start date and keeps three", () => {
    const list = ["2027-03-01", "2026-11-01", "2027-01-01", "2026-12-01"].map((d) => w(d, d, 1, {}));
    expect(soonest(list).map((x) => x.start)).toEqual(["2026-11-01", "2026-12-01", "2027-01-01"]);
  });
});
