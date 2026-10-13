/** Per-browser preferences. Nothing here is important: if storage is blocked, the defaults apply. */

const HIDDEN_KEY = "vo.hiddenSchedules";

/** People whose school breaks and busy days you chose NOT to see on the calendar. */
export function loadHidden(): number[] {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(HIDDEN_KEY) ?? "[]");
    return Array.isArray(parsed) ? parsed.filter((id): id is number => Number.isInteger(id)) : [];
  } catch {
    return []; // no storage (server render, private window) or bad data
  }
}

export function saveHidden(ids: number[]): void {
  try {
    localStorage.setItem(HIDDEN_KEY, JSON.stringify(ids));
  } catch {
    // not saving is fine; the choice just won't be remembered
  }
}
