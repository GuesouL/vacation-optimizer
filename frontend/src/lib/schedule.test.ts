import { describe, expect, it } from "vitest";

import type { IcsPreview } from "./api";
import { kindsFor, rangeProblem, skippedNote, summerBreak, toDrafts, toRows } from "./schedule";

describe("summerBreak", () => {
  it("runs from the day after school ends to the day before it restarts", () => {
    expect(summerBreak("2027-06-28", "2027-09-09")).toEqual({
      title: "Summer break", start_date: "2027-06-29", end_date: "2027-09-08", effect: "DAY_OFF",
    });
  });

  it("crosses a month and a year without shifting a day", () => {
    expect(summerBreak("2026-12-31", "2027-01-04")).toMatchObject({ start_date: "2027-01-01", end_date: "2027-01-03" });
  });

  it("is nothing when school starts the day after it ends", () => {
    expect(summerBreak("2027-06-28", "2027-06-29")).toBeNull();
    expect(summerBreak("2027-06-28", "2027-06-01")).toBeNull();
  });
});

describe("rangeProblem", () => {
  it("catches the usual mistakes", () => {
    expect(rangeProblem(" ", "2027-04-05", "2027-04-09")).toBe("Give it a name");
    expect(rangeProblem("Break", "", "2027-04-09")).toBe("Pick the first and last day");
    expect(rangeProblem("Break", "2027-04-09", "2027-04-05")).toBe("The last day can't be before the first day");
    expect(rangeProblem("Break", "2027-04-05", "2027-04-05")).toBeNull(); // one day is fine
  });
});

describe("kindsFor", () => {
  it("offers a school calendar for kids and work dates for adults", () => {
    expect(kindsFor("CHILD").map((k) => k.kind)).toEqual(["SCHOOL", "LEAGUE"]);
    expect(kindsFor("ADULT").map((k) => k.kind)).toEqual(["WORK", "LEAGUE", "CUSTOM"]);
  });
});

const preview = (over: Partial<IcsPreview> = {}): IcsPreview => ({
  events: [
    { title: "Spring Break", start_date: "2027-04-05", end_date: "2027-04-09", effect: "DAY_OFF", selected: true, timed: false },
    { title: "Away game", start_date: "2027-04-10", end_date: "2027-04-10", effect: "BUSY", selected: false, timed: true },
  ],
  skipped_recurring: 0, skipped_too_long: 0, skipped_invalid: 0, truncated: false,
  ...over,
});

describe("import review", () => {
  it("ticks the suggested rows and saves only those, with the chosen effect", () => {
    const rows = toRows(preview());
    expect(rows.map((r) => r.checked)).toEqual([true, false]);
    rows[1].checked = true;
    rows[1].effect = "DAY_OFF"; // the user changed their mind
    expect(toDrafts(rows)).toEqual([
      { title: "Spring Break", start_date: "2027-04-05", end_date: "2027-04-09", effect: "DAY_OFF" },
      { title: "Away game", start_date: "2027-04-10", end_date: "2027-04-10", effect: "DAY_OFF" },
    ]);
  });

  it("says what was left out", () => {
    expect(skippedNote(preview())).toBe("");
    expect(skippedNote(preview({ skipped_recurring: 2, truncated: true }))).toBe(
      "Left out: 2 repeating events (like weekly practices), everything after the first 500.",
    );
  });
});
