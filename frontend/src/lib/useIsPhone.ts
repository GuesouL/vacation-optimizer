import { useSyncExternalStore } from "react";

const QUERY = "(max-width: 47.99rem)"; // Tailwind's md breakpoint (48rem), minus a hair

/**
 * True on phone-width screens. Used where something must exist on only one layout:
 * a modal that is merely hidden by CSS would still block the page behind it.
 */
export function useIsPhone(): boolean {
  return useSyncExternalStore(
    (notify) => {
      const query = window.matchMedia(QUERY);
      query.addEventListener("change", notify);
      return () => query.removeEventListener("change", notify);
    },
    () => window.matchMedia(QUERY).matches,
    () => false,
  );
}
