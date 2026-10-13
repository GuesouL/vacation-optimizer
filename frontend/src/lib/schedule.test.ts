import { describe, expect, it } from "vitest";

import type { IcsPreview, PersonSchedule } from "./api";
import { buildDayMarks, kindsFor, rangeProblem, skippedNote, summerBreak, toDrafts, toRows } from "./schedule";

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

const person = (name: string, items: PersonSchedule["items"]): PersonSchedule => ({ person_id: 1, name, kind: "CHILD", items });
const item = (title: string, start: string, end: string, effect: "DAY_OFF" | "BUSY" = "DAY_OFF", kind: PersonSchedule["items"][number]["kind"] = "SCHOOL") => ({
  title, start_date: start, end_date: end, effect, kind,
});

describe("buildDayMarks", () => {
  it("marks every day of a break, both ends included", () => {
    const marks = buildDayMarks([person("Noah", [item("Spring break", "2027-04-05", "2027-04-09")])], "2027-01-01", "2027-12-31");
    expect([...marks.keys()]).toEqual(["2027-04-05", "2027-04-06", "2027-04-07", "2027-04-08", "2027-04-09"]);
    expect(marks.get("2027-04-05")).toEqual({ off: ["Noah: Spring break (No school)"], busy: [] });
  });

  it("keeps only the days on screen", () => {
    const marks = buildDayMarks([person("Noah", [item("Summer", "2026-06-29", "2026-09-09")])], "2026-08-30", "2026-09-02");
    expect([...marks.keys()]).toEqual(["2026-08-30", "2026-08-31", "2026-09-01", "2026-09-02"]);
    expect(buildDayMarks([person("Noah", [item("Old", "2025-01-01", "2025-01-05")])], "2026-01-01", "2026-12-31").size).toBe(0);
  });

  it("lets busy beat a day off for the same person, like the engine", () => {
    const marks = buildDayMarks(
      [person("Noah", [item("Spring break", "2027-04-05", "2027-04-09"), item("Tournament", "2027-04-07", "2027-04-07", "BUSY", "LEAGUE")])],
      "2027-01-01", "2027-12-31",
    );
    expect(marks.get("2027-04-06")).toEqual({ off: ["Noah: Spring break (No school)"], busy: [] });
    expect(marks.get("2027-04-07")).toEqual({ off: [], busy: ["Noah: Tournament (Busy)"] });
  });

  it("lists each person on a shared day and says 'Day off' outside school calendars", () => {
    const marks = buildDayMarks(
      [person("Noah", [item("Break", "2027-04-05", "2027-04-05")]), { ...person("Ana", [item("Company day", "2027-04-05", "2027-04-05", "DAY_OFF", "WORK")]), person_id: 2 }],
      "2027-01-01", "2027-12-31",
    );
    expect(marks.get("2027-04-05")?.off).toEqual(["Noah: Break (No school)", "Ana: Company day (Day off)"]);
  });
});
