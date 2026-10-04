/**
 * Remembers which plan this browser belongs to. There are no accounts until
 * Phase 4, so the ids live in localStorage, like a claim ticket.
 */

const KEY = "vacation-optimizer.plan";

export type SavedPlan = { personId: number; groupId: number };

export function loadPlan(): SavedPlan | null {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as SavedPlan) : null;
  } catch {
    return null; // private browsing or blocked storage: just start fresh
  }
}

export function savePlan(plan: SavedPlan): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(plan));
  } catch {
    // ignore: the plan still works for this visit
  }
}

export function clearPlan(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    // ignore
  }
}
