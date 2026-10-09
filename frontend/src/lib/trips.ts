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
