"use client";

import { useState } from "react";

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
};

/**
 * The Calendar tab: the year ribbon on top, then one month at a time on phones
 * (three on laptops) with arrows. Tap a ribbon month to jump there, or a day to
 * read everything on it underneath.
 */
export default function MonthCalendar(props: Props) {
  const months = next12Months(props.start);
  const [offset, setOffset] = useState(0);
  const [day, setDay] = useState<ISODate | null>(null);
  const shown = months.slice(offset, offset + 3);
  const first = shown[0];

  return (
    <div>
      <Ribbon months={months} offset={offset} onJump={setOffset} saved={props.saved} picks={props.picks} />

      <div className="mt-4 flex items-center justify-between gap-2">
        <button
          onClick={() => setOffset((o) => o - 1)}
          disabled={offset === 0}
          aria-label="Previous month"
          className="grid h-10 w-10 place-items-center rounded-lg text-2xl text-app-muted disabled:opacity-40"
        >
          ‹
        </button>
        {/* Announced to screen readers when the arrows change the month. */}
        <h2 aria-live="polite" className="font-display text-lg font-bold">
          {label(first)}
          {shown.length > 1 && <span className="hidden md:inline"> – {label(shown[shown.length - 1])}</span>}
        </h2>
        <button
          onClick={() => setOffset((o) => o + 1)}
          disabled={offset === months.length - 1}
          aria-label="Next month"
          className="grid h-10 w-10 place-items-center rounded-lg text-2xl text-app-muted disabled:opacity-40"
        >
          ›
        </button>
      </div>

      <div className="mt-2 grid gap-6 md:grid-cols-3">
        {shown.map(({ year, month }, i) => (
          // Phones show only the first month; laptops show all three.
          <div key={`${year}-${month}`} className={i > 0 ? "hidden md:block" : ""}>
            <MonthGrid {...props} selected={null} year={year} month={month} chosen={day} onDay={setDay} phoneTitle={false} large />
          </div>
        ))}
      </div>

      <p className="mt-3 min-h-[2.6em] text-sm" aria-live="polite">
        {day ? (
          <>
            <span className="font-bold">{formatDate(day)}</span> · {describeDay(day, { ...props, selected: null })}
          </>
        ) : (
          "Tap a day to see what's on it."
        )}
      </p>
    </div>
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
