/**
 * Holds the API token between calls. Asking the server for a session on every
 * request would double the traffic, so we reuse the token until a minute
 * before it expires, like topping off fluid before the light comes on.
 */

const LIFETIME_MS = 15 * 60_000; // matches setExpirationTime("15m") in auth.ts
const REFRESH_EARLY_MS = 60_000;

export function tokenCache(fetchToken: () => Promise<string | null>, now: () => number = Date.now) {
  let cached: { token: string; expiresAt: number } | null = null;
  let pending: Promise<string | null> | null = null;

  async function refresh(): Promise<string | null> {
    const issuedAt = now();
    const token = await fetchToken();
    cached = token ? { token, expiresAt: issuedAt + LIFETIME_MS } : null;
    return token;
  }

  return {
    async get(): Promise<string | null> {
      if (cached && cached.expiresAt - now() > REFRESH_EARLY_MS) return cached.token;
      // Five calls at once share one refresh instead of starting five.
      pending ??= refresh().finally(() => (pending = null));
      return pending;
    },
    clear() {
      cached = null;
    },
  };
}
