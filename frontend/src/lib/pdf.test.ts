import { describe, expect, it } from "vitest";

import { isPdf, pdfNote, toBase64 } from "./pdf";

describe("pdf helpers", () => {
  it("spots PDFs by type or name", () => {
    expect(isPdf({ name: "cal.PDF", type: "" })).toBe(true);
    expect(isPdf({ name: "x", type: "application/pdf" })).toBe(true);
    expect(isPdf({ name: "cal.ics", type: "text/calendar" })).toBe(false);
  });

  it("encodes bytes as base64, even big ones", () => {
    expect(toBase64(new TextEncoder().encode("%PDF-1.4").buffer)).toBe("JVBERi0xLjQ=");
    const big = new Uint8Array(200_000).fill(65);
    expect(atob(toBase64(big.buffer)).length).toBe(200_000);
  });

  it("explains where the dates came from", () => {
    const event = { title: "Winter Recess", start_date: "2026-12-24", end_date: "2026-12-31", effect: "DAY_OFF" as const, selected: true, timed: false };
    expect(pdfNote({ method: "AI", note: null, events: [event] })).toMatch(/automatically/);
    expect(pdfNote({ method: "TEXT", note: "Paused.", events: [] })).toBe("Paused.");
    expect(pdfNote({ method: "NONE", note: null, events: [] })).toBe("");
  });
});
