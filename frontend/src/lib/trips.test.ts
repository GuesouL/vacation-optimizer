import { describe, expect, it } from "vitest";

import { bookedBy, isSaved } from "./trips";

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
