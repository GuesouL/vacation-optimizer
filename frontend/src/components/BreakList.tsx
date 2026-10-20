"use client";

import { chip, listCard, sectionHead } from "@/components/ui";
import type { Window } from "@/lib/api";
import { whyText } from "@/lib/breaks";
import { formatRange, type ISODate } from "@/lib/dates";
import type { DayMark } from "@/lib/schedule";
import { isSaved } from "@/lib/trips";
import { groupByCost } from "@/lib/whofree";

export type View = "best_value" | "longest" | "free";

const VIEWS: [View, string][] = [
  ["best_value", "Best value"],
  ["longest", "Longest"],
  ["free", "Free"],
];

/**
 * The Breaks list from the mockup: a three-way switch (Best value, Longest, Free),
 * then the suggestions grouped under "1 PTO day → 4 days off" so that line isn't
 * repeated on every row. Each row says why the break works (a holiday, a school break).
 */
export default function BreakList(props: {
  view: View;
  onView: (view: View) => void;
  windows: Window[]; // ranked by the current sort
  free: Window[]; // long weekends that cost no PTO
  selected: Window | null;
  trips: { start_date: ISODate; end_date: ISODate }[];
  holidays: Map<ISODate, string>;
  marks: Map<ISODate, DayMark>;
  empty: string;
  onSelect: (w: Window) => void;
}) {
  const why = (w: Window) => whyText(w.start, w.end, props.holidays, props.marks) ?? `${w.days} days off`;
  const groups =
    props.view === "free"
      ? [{ label: "No PTO needed", windows: props.free }]
      : groupByCost(props.windows);

  return (
    <div className="grid content-start gap-4">
      <div role="group" aria-label="Sort" className="flex gap-[3px] rounded-[10px] bg-app-tile p-[3px] text-sm">
        {VIEWS.map(([value, label]) => (
          <button
            key={value}
            aria-pressed={props.view === value}
            onClick={() => props.onView(value)}
            className={`flex-1 rounded-lg py-1.5 ${
              props.view === value ? "bg-app-surface font-bold" : "text-app-muted"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {groups.every((g) => g.windows.length === 0) ? (
        <p className="text-sm text-app-muted">{props.view === "free" ? "None in this range." : props.empty}</p>
      ) : (
        groups.map((group) => (
          <section key={group.label} aria-label={group.label}>
            <h2 className={sectionHead}>{group.label}</h2>
            <ul className={`mt-1.5 ${listCard}`}>
              {group.windows.map((w) => {
                const active = props.selected?.start === w.start && props.selected?.end === w.end;
                return (
                  <li key={`${w.start}-${w.end}`}>
                    <button
                      onClick={() => props.onSelect(w)}
                      aria-pressed={active}
                      className={`flex w-full items-center justify-between gap-2 px-4 py-2.5 text-left ${active ? "bg-app-soft" : ""}`}
                    >
                      <span>
                        <span className="block">{formatRange(w.start, w.end)}</span>
                        <span className="block text-sm text-app-muted">{why(w)}</span>
                      </span>
                      {isSaved(props.trips, w.start, w.end) && <span className={chip}>Saved</span>}
                    </button>
                  </li>
                );
              })}
            </ul>
          </section>
        ))
      )}
    </div>
  );
}
