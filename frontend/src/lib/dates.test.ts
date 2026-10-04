import { describe, expect, it } from "vitest";

import {
  addDays,
  formatDate,
  formatRange,
  monthGrid,
  next12Months,
  today,
  weekday,
} from "./dates";

// `npm test` runs with TZ=America/Los_Angeles on purpose: if any helper used
// local time, Nov 26 would turn into Nov 25 and these tests would fail.
describe("plain dates", () => {
  it("never shifts a day across time zones", () => {
    expect(formatDate("2026-11-26")).toBe("Thu, Nov 26");
  });

  it("adds days across months, years and leap day", () => {
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDays("2028-02-28", 1)).toBe("2028-02-29");
    expect(addDays("2026-03-08", 1)).toBe("2026-03-09"); // daylight saving starts
  });

  it("numbers weekdays like Python (Mon=0)", () => {
    expect(weekday("2026-11-23")).toBe(0); // Monday
    expect(weekday("2026-11-29")).toBe(6); // Sunday
  });

  it("uses the user's own calendar day for today", () => {
    expect(today(new Date(2026, 9, 4, 23, 30))).toBe("2026-10-04"); // 11:30pm local
  });

  it("formats ranges, adding the year when they cross one", () => {
    expect(formatRange("2026-11-26", "2026-11-29")).toBe("Thu, Nov 26 – Sun, Nov 29");
    expect(formatRange("2026-12-24", "2027-01-03")).toBe("Thu, Dec 24 – Sun, Jan 3, 2027");
  });
});

describe("calendar grid", () => {
  it("starts Nov 2026 on a Sunday, the last column", () => {
    const grid = monthGrid(2026, 11);
    expect(grid[0]).toEqual([null, null, null, null, null, null, "2026-11-01"]);
    expect(grid.flat().filter(Boolean)).toHaveLength(30);
    expect(grid.every((row) => row.length === 7)).toBe(true);
  });

  it("includes Feb 29 in a leap year", () => {
    expect(monthGrid(2028, 2).flat()).toContain("2028-02-29");
  });

  it("lists 12 months, rolling into the next year", () => {
    const months = next12Months("2026-10-04");
    expect(months[0]).toEqual({ year: 2026, month: 10 });
    expect(months[11]).toEqual({ year: 2027, month: 9 });
  });
});
