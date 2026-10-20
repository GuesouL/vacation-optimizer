/** The plan page's four tabs, in the order the tab bars show them. */
export const TABS = [
  { id: "home", label: "Home" },
  { id: "breaks", label: "Breaks" },
  { id: "calendar", label: "Calendar" },
  { id: "people", label: "People" },
] as const;

export type Tab = (typeof TABS)[number]["id"];

/** Reads ?tab= from the URL. Anything missing or unknown opens Home. */
export function parseTab(value: string | null): Tab {
  return TABS.find((t) => t.id === value)?.id ?? "home";
}

/** The query string for a tab ("" when there's nothing to add), keeping every other param (like ?group=). Home is the default, so it drops ?tab=. */
export function tabQuery(current: URLSearchParams, tab: Tab): string {
  const next = new URLSearchParams(current);
  if (tab === "home") next.delete("tab");
  else next.set("tab", tab);
  const query = next.toString();
  return query ? `?${query}` : "";
}
