import type { Window } from "./api";

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

/**
 * One line under each suggestion. Alone: "9 days off for 4 PTO days".
 * In a group, everyone's share: "9 days off · Pat 4, Lee 3 PTO days".
 */
export function describeCost(window: Window): string {
  const costs = Object.entries(window.pto_cost);
  const total = costs.reduce((sum, [, cost]) => sum + cost, 0);
  if (total === 0) return `${window.days} days off, no PTO needed`;
  if (costs.length === 1) return `${window.days} days off for ${plural(costs[0][1], "PTO day")}`;
  const shares = costs.map(([name, cost]) => `${name} ${cost}`).join(", ");
  return `${window.days} days off · ${shares} PTO`;
}
