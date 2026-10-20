import { describe, expect, it } from "vitest";

import { parseTab, tabQuery } from "./tabs";

describe("parseTab", () => {
  it("reads a known tab", () => {
    expect(parseTab("calendar")).toBe("calendar");
    expect(parseTab("people")).toBe("people");
  });

  it("opens Home for anything else", () => {
    expect(parseTab(null)).toBe("home");
    expect(parseTab("")).toBe("home");
    expect(parseTab("settings")).toBe("home");
    expect(parseTab("CALENDAR")).toBe("home");
  });
});

describe("tabQuery", () => {
  it("keeps the group when switching tabs", () => {
    expect(tabQuery(new URLSearchParams("group=12"), "breaks")).toBe("?group=12&tab=breaks");
    expect(tabQuery(new URLSearchParams("group=12&tab=breaks"), "people")).toBe("?group=12&tab=people");
  });

  it("drops ?tab= for Home", () => {
    expect(tabQuery(new URLSearchParams("group=12&tab=breaks"), "home")).toBe("?group=12");
    expect(tabQuery(new URLSearchParams("tab=people"), "home")).toBe("");
  });
});
