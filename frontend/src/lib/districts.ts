import type { components } from "./api-types";

export type District = components["schemas"]["DistrictOut"];

/** Two-letter codes for the state filter: the 50 states plus DC. */
export const STATES = [
  "AL", "AK", "AZ", "AR", "CA", "CO", "CT", "DE", "DC", "FL", "GA", "HI", "ID", "IL", "IN", "IA", "KS",
  "KY", "LA", "ME", "MD", "MA", "MI", "MN", "MS", "MO", "MT", "NE", "NV", "NH", "NJ", "NM", "NY", "NC",
  "ND", "OH", "OK", "OR", "PA", "RI", "SC", "SD", "TN", "TX", "UT", "VT", "VA", "WA", "WV", "WI", "WY",
] as const;

/** The server wants at least 2 characters; one letter would match thousands of districts. */
export function searchable(query: string): string | null {
  const q = query.trim().replace(/\s+/g, " ");
  return q.length >= 2 ? q : null;
}

/** "Brentwood, NY" under the district's name, so two Brentwoods can be told apart. */
export function districtPlace(d: Pick<District, "city" | "state">): string {
  return d.city ? `${d.city}, ${d.state}` : d.state;
}

/** What tapping a result will do. */
export function calendarStatus(d: Pick<District, "calendar">): string {
  if (!d.calendar) return "No calendar yet: you'll add its dates";
  return d.calendar.school_year ? `${d.calendar.school_year} calendar ready` : "Calendar ready";
}
