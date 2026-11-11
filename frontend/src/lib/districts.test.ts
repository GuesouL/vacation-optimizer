import { describe, expect, it } from "vitest";

import { calendarStatus, districtPlace, searchable } from "./districts";

describe("searchable", () => {
  it("waits for two characters and tidies spaces", () => {
    expect(searchable(" b ")).toBeNull();
    expect(searchable("  brent   wood ")).toBe("brent wood");
    expect(searchable("11717")).toBe("11717");
  });
});

describe("district labels", () => {
  it("says where it is and whether a calendar is ready", () => {
    expect(districtPlace({ city: "Brentwood", state: "NY" })).toBe("Brentwood, NY");
    expect(districtPlace({ city: "", state: "NY" })).toBe("NY");
    expect(calendarStatus({ calendar: { id: 1, name: "NYC", school_year: "2026-27" } })).toBe("2026-27 calendar ready");
    expect(calendarStatus({ calendar: { id: 1, name: "NYC", school_year: null } })).toBe("Calendar ready");
    expect(calendarStatus({ calendar: null })).toBe("No calendar yet: you'll add its dates");
  });
});
