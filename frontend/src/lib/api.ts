/**
 * Typed API client. `api-types.ts` is generated from the back end's OpenAPI
 * schema (`npm run gen:api`), so a wrong URL or field name fails the
 * TypeScript build instead of failing in the browser.
 */
import { getSession } from "next-auth/react";
import createClient from "openapi-fetch";

import type { components, paths } from "./api-types";
import { tokenCache } from "./token-cache";

export type Person = components["schemas"]["PersonOut"];
export type Group = components["schemas"]["GroupOut"];
export type Window = components["schemas"]["WindowOut"];
export type Search = components["schemas"]["SearchOut"];
export type Holiday = components["schemas"]["Holiday"];
export type Me = components["schemas"]["MeOut"];
export type Trip = components["schemas"]["TripOut"];
export type CalendarInfo = components["schemas"]["PersonCalendarOut"];
export type CalendarEvent = components["schemas"]["EventOut"];
export type IcsPreview = components["schemas"]["IcsPreviewOut"];
export type EventDraft = components["schemas"]["EventIn"];

export const FEDERAL_CALENDAR_ID = 1; // seeded by the first database migration

export const api = createClient<paths>({
  baseUrl: process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000",
});

export const apiToken = tokenCache(async () => (await getSession())?.apiToken ?? null);

// Middleware: every request gets "Authorization: Bearer <token>" stamped on it.
api.use({
  async onRequest({ request }) {
    const token = await apiToken.get();
    if (token) request.headers.set("Authorization", `Bearer ${token}`);
    return request;
  },
});

/** Turn an API error body into one readable sentence. */
export function errorMessage(error: unknown): string {
  const detail = (error as { detail?: unknown })?.detail;
  if (typeof detail === "string") return detail;
  if (Array.isArray(detail) && detail[0]?.msg) return String(detail[0].msg).replace(/^Value error, /, "");
  return "Something went wrong. Is the API running?";
}
