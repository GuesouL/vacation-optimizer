import { describe, expect, it } from "vitest";

import { federalSkips, holidaysYouGet, presetOf, skippedFor, upcoming } from "./holidays";

const NAMES = [
  "New Year's Day", "Martin Luther King Jr. Day", "Presidents Day", "Memorial Day", "Juneteenth",
  "Independence Day", "Labor Day", "Columbus Day", "Veterans Day", "Thanksgiving", "Christmas Day",
];

describe("presets", () => {
  it("Big 6 skips the five holidays most private employers don't give", () => {
    expect(skippedFor("big6", NAMES)).toEqual([
      "Martin Luther King Jr. Day", "Presidents Day", "Juneteenth", "Columbus Day", "Veterans Day",
    ]);
  });

  it("all skips nothing and none skips everything", () => {
    expect(skippedFor("all", NAMES)).toEqual([]);
    expect(skippedFor("none", NAMES)).toEqual(NAMES);
  });

  it("recognizes a preset in any order, and nothing once a box is changed", () => {
    expect(presetOf([...skippedFor("big6", NAMES)].reverse(), NAMES)).toBe("big6");
    expect(presetOf(["Columbus Day"], NAMES)).toBeNull();
  });
});

describe("upcoming", () => {
  const thisYear = [
    { date: "2027-01-01", name: "New Year's Day" },
    { date: "2027-10-11", name: "Columbus Day" },
    { date: "2027-12-31", name: "New Year's Day" }, // 2028's, observed the Friday before
  ];
  const nextYear = [
    { date: "2027-12-31", name: "New Year's Day" },
    { date: "2028-10-09", name: "Columbus Day" },
  ];

  it("lists each holiday once, on its next date", () => {
    expect(upcoming([thisYear, nextYear], "2027-10-23")).toEqual([
      { date: "2027-12-31", name: "New Year's Day" },
      { date: "2028-10-09", name: "Columbus Day" },
    ]);
  });

  it("keeps this year's date when it hasn't passed", () => {
    expect(upcoming([thisYear, nextYear], "2027-01-01")[0]).toEqual({ date: "2027-01-01", name: "New Year's Day" });
  });
});

describe("holidaysYouGet", () => {
  const all = new Map([["2027-10-11", "Columbus Day"], ["2027-11-25", "Thanksgiving"]]);

  it("drops the holidays you work", () => {
    expect([...holidaysYouGet(all, ["Columbus Day"]).values()]).toEqual(["Thanksgiving"]);
  });

  it("drops them all when you're not on the federal calendar", () => {
    expect(holidaysYouGet(all, null).size).toBe(0);
  });
});

describe("federalSkips", () => {
  const link = { id: 1, name: "US Federal Holidays", kind: "FEDERAL" as const, mine: false, enabled: true };

  it("reads the skipped holidays off the federal link", () => {
    expect(federalSkips([{ ...link, excluded_titles: ["Juneteenth"] }])).toEqual(["Juneteenth"]);
  });

  it("is null with no federal link, or a switched-off one", () => {
    expect(federalSkips([])).toBeNull();
    expect(federalSkips([{ ...link, enabled: false, excluded_titles: [] }])).toBeNull();
  });
});
