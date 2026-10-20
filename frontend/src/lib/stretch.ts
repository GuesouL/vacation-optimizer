import type { Window } from "./api";

/** The most PTO anyone spends on a window. That person decides whether the trip fits. */
export const ptoCost = (w: Window) => Math.max(0, ...Object.values(w.pto_cost));

/**
 * How far your PTO goes: take the best-value breaks first (most days off per PTO day,
 * like the engine's ranking), skip any that overlap one already taken or cost more
 * than what's left, and add up the days off. A quick greedy count, not a perfect
 * packing, which is plenty for a headline number.
 */
export function stretch(windows: Window[], budget: number) {
  const byValue = [...windows]
    .filter((w) => ptoCost(w) > 0)
    .sort((a, b) => b.days / ptoCost(b) - a.days / ptoCost(a) || a.start.localeCompare(b.start));
  const picks: Window[] = [];
  let used = 0;
  for (const w of byValue) {
    const cost = ptoCost(w);
    const overlaps = picks.some((p) => w.start <= p.end && p.start <= w.end);
    if (overlaps || used + cost > budget) continue;
    picks.push(w);
    used += cost;
  }
  return { picks, used, daysOff: picks.reduce((sum, w) => sum + w.days, 0) };
}

/** The next few breaks the whole plan can take together, soonest first. */
export function soonest(windows: Window[], count = 3): Window[] {
  return [...windows].sort((a, b) => a.start.localeCompare(b.start)).slice(0, count);
}
