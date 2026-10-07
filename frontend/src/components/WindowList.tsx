"use client";

import type { Window } from "@/lib/api";
import { formatRange } from "@/lib/dates";

/** A titled list of trip suggestions; tap one to show it on the calendar. */
export default function WindowList(props: {
  title: string;
  empty: string;
  windows: Window[];
  selected: Window | null;
  onSelect: (w: Window) => void;
  describe: (w: Window) => string;
  badge: (w: Window) => string | null;
}) {
  return (
    <div className="mt-6">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-500">{props.title}</h2>
      {props.windows.length === 0 ? (
        <p className="mt-2 text-sm text-zinc-500">{props.empty}</p>
      ) : (
        <ol className="mt-2 space-y-2">
          {props.windows.map((w) => {
            const active = props.selected?.start === w.start && props.selected?.end === w.end;
            const badge = props.badge(w);
            return (
              <li key={`${w.start}-${w.end}`}>
                <button
                  onClick={() => props.onSelect(w)}
                  aria-pressed={active}
                  className={`w-full rounded-xl border px-4 py-3 text-left transition ${
                    active
                      ? "border-teal-600 bg-teal-50 dark:bg-teal-950"
                      : "border-zinc-200 hover:border-zinc-400 dark:border-zinc-800"
                  }`}
                >
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="font-medium">{formatRange(w.start, w.end)}</span>
                    {badge && <span className="text-sm font-semibold text-teal-700 dark:text-teal-400">{badge}</span>}
                  </div>
                  <div className="text-sm text-zinc-500">{props.describe(w)}</div>
                </button>
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}
