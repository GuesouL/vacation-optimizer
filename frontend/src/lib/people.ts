import type { Group } from "./api";

type Member = Group["people"][number];

/** The grey line under a name on the People tab: who they are, and their PTO if we know it. */
export function personLine(p: Member, selfId: number | null | undefined): string {
  const role =
    p.id === selfId ? "You"
    : p.kind === "CHILD" ? "Kid"
    : p.kind === "GUEST" ? "Guest"
    : p.mine ? "Adult you manage"
    : "Joined from an invite";
  if (p.kind !== "ADULT" || p.pto_left == null) return role;
  const left = `${p.pto_left} PTO ${p.pto_left === 1 ? "day" : "days"} left`;
  return `${role} · ${p.pto_balance != null ? `${p.pto_left} of ${p.pto_balance} PTO days left` : left}`;
}
