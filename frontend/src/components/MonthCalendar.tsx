"use client";

import { type ReactNode, useState } from "react";

import { MonthGrid } from "@/components/YearCalendar";
import { describeDay } from "@/lib/breaks";
import { monthFill } from "@/lib/calendar";
import { formatDate, type ISODate, next12Months } from "@/lib/dates";
import type { DayMark } from "@/lib/schedule";

const MONTH = new Intl.DateTimeFormat("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
const label = ({ year, month }: { year: number; month: number }) => MONTH.format(Date.UTC(year, month - 1, 1));

type Props = {
  start: ISODate;
  holidays: Map<ISODate, string>;
  workWeek: number[];
  saved: { start_date: ISODate; end_date: ISODate }[];
  picks: { start: ISODate; end: ISODate }[];
  marks: Map<ISODate, DayMark>;
  people: { id: number; name: string; shown: boolean }[]; // people whose dates can be switched on and off
  onToggle: (personId: number, show: boolean) => void;
  legend: ReactNode;
};

/**
 * The Calendar tab. Phones: the year ribbon on top, then one month at a time with arrows;
 * tap a ribbon month to jump there. Laptops: three months side by side with arrows at the
 * ends, and a Day details panel with switches for whose dates are drawn. Either way, tap a
 * day to read everything on it.
 */
export default function MonthCalendar({ people, onToggle, legend, ...props }: Props) {
  const months = next12Months(props.start);
  const [offset, setOffset] = useState(0);
  const [day, setDay] = useState<ISODate | null>(null);
  const shown = months.slice(offset, offset + 3);
  const first = shown[0];
  const prev = () => setOffset((o) => o - 1);
  const next = () => setOffset((o) => o + 1);
  const arrow = "grid h-10 w-10 place-items-center rounded-lg text-2xl text-app-muted disabled:opacity-40";

  const info = day ? (
    <>
      <span className="font-bold">{formatDate(day)}</span>
      <span className="hidden md:block" />
      <span className="md:hidden"> · </span>
      {describeDay(day, { ...props, selected: null })}
    </>
  ) : (
    "Tap a day to see what's on it."
  );

  return (
    <div className="md:grid md:grid-cols-[repeat(3,1fr)_14rem] md:items-start md:gap-6">
      <div className="md:hidden">
        <Ribbon months={months} offset={offset} onJump={setOffset} saved={props.saved} picks={props.picks} />

        <div className="mt-4 flex items-center justify-between gap-2">
          <button onClick={prev} disabled={offset === 0} aria-label="Previous month" className={arrow}>‹</button>
          {/* Announced to screen readers when the arrows change the month. */}
          <h2 aria-live="polite" className="font-display text-lg font-bold">{label(first)}</h2>
          <button onClick={next} disabled={offset === months.length - 1} aria-label="Next month" className={arrow}>›</button>
        </div>
      </div>

      {shown.map(({ year, month }, i) => (
        // Phones show only the first month; laptops show all three, each with its own heading.
        <div key={`${year}-${month}`} className={`${i > 0 ? "hidden md:block" : ""} mt-2 md:mt-0`}>
          <div className="mb-2 hidden h-8 items-center justify-between md:flex">
            {i === 0 ? (
              <button onClick={prev} disabled={offset === 0} aria-label="Earlier" className="px-2 text-xl text-app-muted disabled:opacity-40">‹</button>
            ) : (
              <span />
            )}
            <h2 className="font-display text-base font-bold">{label({ year, month })}</h2>
            {i === shown.length - 1 ? (
              <button onClick={next} disabled={offset >= months.length - 3} aria-label="Later" className="px-2 text-xl text-app-muted disabled:opacity-40">›</button>
            ) : (
              <span />
            )}
          </div>
          <MonthGrid {...props} selected={null} year={year} month={month} chosen={day} onDay={setDay} heading={false} large />
        </div>
      ))}

      <p className="mt-3 min-h-[2.6em] text-sm md:hidden" aria-live="polite">{info}</p>
      <div className="md:hidden">{legend}</div>

      <aside aria-label="Day details" className="hidden gap-2.5 rounded-2xl border border-app-line bg-app-surface p-3.5 md:grid">
        <h2 className="font-bold">Day details</h2>
        <p className="min-h-[3em] text-sm" aria-live="polite">{info}</p>
        {people.length > 0 && (
          <>
            <h3 className="text-xs font-bold uppercase tracking-[0.07em] text-app-muted">Show on calendar</h3>
            {people.map((p) => (
              <label key={p.id} className="flex cursor-pointer items-center justify-between gap-2 text-sm">
                <span>{p.name}</span>
                <input
                  type="checkbox"
                  role="switch"
                  checked={p.shown}
                  onChange={(e) => onToggle(p.id, e.target.checked)}
                  className="peer sr-only"
                />
                <Switch on={p.shown} />
              </label>
            ))}
          </>
        )}
        {legend}
      </aside>
    </div>
  );
}

/** The mockup's switch: marigold when on. Drawn from the checkbox before it so it stays keyboard-friendly. */
function Switch({ on }: { on: boolean }) {
  return (
    <span
      aria-hidden="true"
      className={`relative h-5 w-[34px] shrink-0 rounded-full transition-colors peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-foreground ${on ? "bg-app-accent" : "bg-app-tile"}`}
    >
      <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-app-surface transition-[left] motion-reduce:transition-none ${on ? "left-4" : "left-0.5"}`} />
    </span>
  );
}

const LETTER = new Intl.DateTimeFormat("en-US", { month: "narrow", timeZone: "UTC" });

/**
 * Twelve bars, one per month: marigold where a saved trip falls, pale gold with a
 * marigold base where a good pick starts. The month on screen gets a bold letter.
 */
function Ribbon(props: {
  months: { year: number; month: number }[];
  offset: number;
  onJump: (offset: number) => void;
  saved: Props["saved"];
  picks: Props["picks"];
}) {
  return (
    <div className="grid grid-cols-12 gap-[3px]" role="group" aria-label="Jump to a month">
      {props.months.map((m, i) => {
        const fill = monthFill(m.year, m.month, props.saved, props.picks);
        const on = i === props.offset;
        return (
          <button
            key={`${m.year}-${m.month}`}
            onClick={() => props.onJump(i)}
            aria-label={`${label(m)}${fill === "trip" ? ": trip" : fill === "pick" ? ": good pick" : ""}`}
            aria-current={on ? "true" : undefined}
            className={`grid justify-items-center gap-[3px] text-[0.7rem] ${on ? "font-bold text-foreground" : "text-app-muted"}`}
          >
            <i
              className={`block h-[34px] w-full rounded-[5px] ${
                fill === "trip"
                  ? "bg-app-accent"
                  : fill === "pick"
                    ? "bg-app-soft shadow-[inset_0_-4px_0_var(--app-accent)]"
                    : "bg-app-tile"
              } ${on ? "ring-2 ring-foreground" : ""}`}
            />
            {LETTER.format(Date.UTC(m.year, m.month - 1, 1))}
          </button>
        );
      })}
    </div>
  );
}
