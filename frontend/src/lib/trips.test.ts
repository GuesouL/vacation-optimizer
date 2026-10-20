import { describe, expect, it } from "vitest";

import { bookedBy, bookedNote, isSaved, nextRenewal } from "./trips";

describe("bookedBy", () => {
  it("names everyone who booked", () => {
    expect(bookedBy([])).toBe("Nobody has booked PTO yet");
    expect(bookedBy(["Pat"])).toBe("Booked by Pat");
    expect(bookedBy(["Pat", "Lee"])).toBe("Booked by Pat and Lee");
    expect(bookedBy(["Pat", "Lee", "Sam"])).toBe("Booked by Pat, Lee and Sam");
  });
});

describe("isSaved", () => {
  const trips = [{ start_date: "2026-12-24", end_date: "2027-01-03" }];

  it("matches the exact range only", () => {
    expect(isSaved(trips, "2026-12-24", "2027-01-03")).toBe(true);
    expect(isSaved(trips, "2026-12-24", "2027-01-02")).toBe(false);
    expect(isSaved([], "2026-12-24", "2027-01-03")).toBe(false);
  });
});

describe("nextRenewal", () => {
  it("defaults to Jan 1 and is always after today", () => {
    expect(nextRenewal("2026-10-20")).toBe("2027-01-01");
    expect(nextRenewal("2026-12-31", null)).toBe("2027-01-01");
  });

  it("uses a work anniversary, rolling to next year once it has passed", () => {
    expect(nextRenewal("2026-10-20", { month: 11, day: 15 })).toBe("2026-11-15");
    expect(nextRenewal("2026-11-15", { month: 11, day: 15 })).toBe("2027-11-15");
    expect(nextRenewal("2026-10-20", { month: 2, day: 29 })).toBe("2027-02-28");
  });
});

describe("bookedNote", () => {
  it("says which year's PTO a booking used", () => {
    expect(bookedNote("2026-12-24", "2027-01-01")).toContain("this year's balance");
    expect(bookedNote("2027-01-15", "2027-01-01")).toBe(
      "Booked. This trip is after your PTO renews (Jan 1), so it comes out of next year's days. This year's balance stays the same.",
    );
  });
});
