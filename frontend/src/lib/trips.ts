/** Words for a saved trip's booking state. Kept out of the component so it's easy to test. */

/** ["Pat"] -> "Booked by Pat"; ["Pat", "Lee", "Sam"] -> "Booked by Pat, Lee and Sam". */
export function bookedBy(names: string[]): string {
  if (names.length === 0) return "Nobody has booked PTO yet";
  if (names.length === 1) return `Booked by ${names[0]}`;
  return `Booked by ${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

/** Is this exact date range already saved? Trips and windows both use inclusive YYYY-MM-DD dates. */
export function isSaved(trips: { start_date: string; end_date: string }[], start: string, end: string): boolean {
  return trips.some((t) => t.start_date === start && t.end_date === end);
}

/** The first PTO renewal strictly after `today` (Jan 1 when none is set), like the API's. */
export function nextRenewal(today: string, renewsOn?: { month: number; day: number } | null): string {
  const { month, day } = renewsOn ?? { month: 1, day: 1 };
  const pad = (n: number) => String(n).padStart(2, "0");
  const year = Number(today.slice(0, 4));
  // Feb 29 renewals land on Feb 28 in other years, like the API.
  const on = (y: number) => {
    const last = new Date(Date.UTC(y, month, 0)).getUTCDate();
    return `${y}-${pad(month)}-${pad(Math.min(day, last))}`;
  };
  return on(year) > today ? on(year) : on(year + 1);
}

/** What booking did to your PTO: trips after the renewal come out of next year's days. */
export function bookedNote(tripStart: string, renewal: string): string {
  return tripStart < renewal
    ? "Booked. Your PTO for this trip came off this year's balance at the top of the screen."
    : `Booked. This trip is after your PTO renews (${formatShort(renewal)}), so it comes out of next year's days. This year's balance stays the same.`;
}

const SHORT = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
const formatShort = (iso: string) => SHORT.format(new Date(`${iso}T00:00:00Z`));
