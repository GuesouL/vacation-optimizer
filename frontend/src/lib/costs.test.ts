import { describe, expect, it } from "vitest";

import type { Window } from "./api";
import { describeCost } from "./costs";

const trip = (pto_cost: Record<string, number>): Window => ({
  start: "2026-11-21", end: "2026-11-29", days: 9, pto_cost, score: null,
});

describe("describeCost", () => {
  it("talks to one person directly", () => {
    expect(describeCost(trip({ Pat: 4 }))).toBe("9 days off for 4 PTO days");
    expect(describeCost(trip({ Pat: 1 }))).toBe("9 days off for 1 PTO day");
  });

  it("lists everyone's share in a group", () => {
    expect(describeCost(trip({ Pat: 4, Lee: 3 }))).toBe("9 days off · Pat 4, Lee 3 PTO");
  });

  it("leaves out people who spend nothing", () => {
    expect(describeCost(trip({ Pat: 1, Mia: 0 }))).toBe("9 days off · Pat 1 PTO");
  });

  it("calls out free breaks", () => {
    expect(describeCost(trip({ Pat: 0, Kid: 0 }))).toBe("9 days off, no PTO needed");
  });
});
