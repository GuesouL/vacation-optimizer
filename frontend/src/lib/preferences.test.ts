import { afterEach, describe, expect, it, vi } from "vitest";

import { loadHidden, saveHidden } from "./preferences";

function fakeStorage(initial: Record<string, string> = {}) {
  const data = { ...initial };
  return {
    getItem: (k: string) => data[k] ?? null,
    setItem: (k: string, v: string) => void (data[k] = v),
  };
}

afterEach(() => vi.unstubAllGlobals());

describe("hidden schedules", () => {
  it("remembers what you hid", () => {
    vi.stubGlobal("localStorage", fakeStorage());
    expect(loadHidden()).toEqual([]);
    saveHidden([3, 7]);
    expect(loadHidden()).toEqual([3, 7]);
  });

  it("ignores bad data", () => {
    vi.stubGlobal("localStorage", fakeStorage({ "vo.hiddenSchedules": '{"oops":1}' }));
    expect(loadHidden()).toEqual([]);
    vi.stubGlobal("localStorage", fakeStorage({ "vo.hiddenSchedules": '[1,"2",null,4]' }));
    expect(loadHidden()).toEqual([1, 4]);
    vi.stubGlobal("localStorage", fakeStorage({ "vo.hiddenSchedules": "not json" }));
    expect(loadHidden()).toEqual([]);
  });

  it("works without storage at all", () => {
    vi.stubGlobal("localStorage", undefined);
    expect(loadHidden()).toEqual([]);
    expect(() => saveHidden([1])).not.toThrow();
  });
});
