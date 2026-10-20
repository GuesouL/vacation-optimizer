"use client";

import type { ReactNode } from "react";

import { TABS, type Tab } from "@/lib/tabs";

type Props = { current: Tab; onChange: (tab: Tab) => void };

// Simple line icons, drawn with the text color so they follow the active/inactive state.
const ICONS: Record<Tab, ReactNode> = {
  home: <path d="M3 11l9-7 9 7v9a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1z" />,
  breaks: <path d="M4 6h16M4 12h16M4 18h10" />,
  calendar: (
    <>
      <rect x="3" y="5" width="18" height="16" rx="2" />
      <path d="M3 10h18M8 3v4M16 3v4" />
    </>
  ),
  people: (
    <>
      <circle cx="9" cy="8" r="3.5" />
      <path d="M2.5 20a6.5 6.5 0 0 1 13 0M16 4.5a3.5 3.5 0 0 1 0 7M18 14a6 6 0 0 1 3.5 6" />
    </>
  ),
};

function Icon({ tab, className }: { tab: Tab; className: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className={className}>
      {ICONS[tab]}
    </svg>
  );
}

/** Laptop and up: the four tabs as one centered pill row in the header. */
export function TabNav({ current, onChange }: Props) {
  return (
    <nav aria-label="Plan sections" className="hidden rounded-xl bg-app-line/60 p-1 md:inline-flex">
      {TABS.map((t) => (
        <button
          key={t.id}
          onClick={() => onChange(t.id)}
          aria-current={current === t.id ? "page" : undefined}
          className={`flex items-center gap-1.5 rounded-lg px-4 py-1.5 text-sm font-medium ${
            current === t.id ? "bg-app-surface text-foreground shadow-sm" : "text-app-muted hover:text-foreground"
          }`}
        >
          <Icon tab={t.id} className="h-4 w-4" />
          {t.label}
        </button>
      ))}
    </nav>
  );
}

/** Phones: the same tabs as a bar pinned to the bottom, where thumbs reach. */
export function TabBar({ current, onChange }: Props) {
  return (
    <nav
      aria-label="Plan sections"
      className="fixed inset-x-0 bottom-0 z-10 grid grid-cols-4 border-t border-app-line bg-app-surface pb-[env(safe-area-inset-bottom)] md:hidden"
    >
      {TABS.map((t) => (
        <button
          key={t.id}
          onClick={() => onChange(t.id)}
          aria-current={current === t.id ? "page" : undefined}
          className={`flex flex-col items-center gap-0.5 py-2 text-xs ${
            current === t.id ? "font-semibold text-app-accent" : "text-app-muted"
          }`}
        >
          <Icon tab={t.id} className="h-6 w-6" />
          {t.label}
        </button>
      ))}
    </nav>
  );
}
