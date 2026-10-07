import { describe, expect, it, vi } from "vitest";

import { tokenCache } from "./token-cache";

describe("tokenCache", () => {
  it("reuses a token until a minute before it expires", async () => {
    let clock = 0;
    const fetchToken = vi.fn(async () => `token-${fetchToken.mock.calls.length}`);
    const cache = tokenCache(fetchToken, () => clock);

    expect(await cache.get()).toBe("token-1");
    clock = 13 * 60_000;
    expect(await cache.get()).toBe("token-1");
    clock = 14 * 60_000 + 1; // inside the last minute
    expect(await cache.get()).toBe("token-2");
    expect(fetchToken).toHaveBeenCalledTimes(2);
  });

  it("shares one refresh between calls made at the same time", async () => {
    const fetchToken = vi.fn(async () => "token");
    const cache = tokenCache(fetchToken);
    await Promise.all([cache.get(), cache.get(), cache.get()]);
    expect(fetchToken).toHaveBeenCalledTimes(1);
  });

  it("asks again after a signed-out answer or clear()", async () => {
    const fetchToken = vi.fn<() => Promise<string | null>>().mockResolvedValueOnce(null).mockResolvedValue("token");
    const cache = tokenCache(fetchToken);
    expect(await cache.get()).toBeNull();
    expect(await cache.get()).toBe("token");
    cache.clear();
    await cache.get();
    expect(fetchToken).toHaveBeenCalledTimes(3);
  });
});
