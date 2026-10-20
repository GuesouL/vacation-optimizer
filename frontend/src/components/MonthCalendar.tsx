"use client";

import { useState } from "react";

import { MonthGrid } from "@/components/YearCalendar";
import { describeDay } from "@/lib/breaks";
import { formatDate, type ISODate, next12Months } from "@/lib/dates";
import type { DayMark } from "@/lib/schedule";

const MONTH = new Intl.DateTimeFormat("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
const label = ({ year, month }: { year: number; month: number }) => MONTH.format(Date.UTC(year, month - 1, 1));

type Props = {
  start: ISODate;
  holidays: Map<ISODate, string>;
  workWeek: number[];
  selected: { start: ISODate; end: ISODate } | null;
  saved: { start_date: ISODate; end_date: ISODate }[];
  marks: Map<ISODate, DayMark>;
};

/**
 * The Calendar tab: one month at a time on phones (three on laptops) with arrows,
 * instead of all twelve at once. Tap a day to read everything on it underneath.
 */
export default function MonthCalendar(props: Props) {
  const months = next12Months(props.start);
  const [offset, setOffset] = useState(0);
  const [day, setDay] = useState<ISODate | null>(null);
  const shown = months.slice(offset, offset + 3);
  const first = shown[0];

  return (
    <div>
      <div className="flex items-center justify-between gap-2">
        <button
          onClick={() => setOffset((o) => o - 1)}
          disabled={offset === 0}
          aria-label="Previous month"
          className="grid h-10 w-10 place-items-center rounded-full bg-app-surface text-xl disabled:opacity-40"
        >
          ‹
        </button>
        {/* Announced to screen readers when the arrows change the month. */}
        <h2 aria-live="polite" className="font-semibold">
          {label(first)}
          {shown.length > 1 && <span className="hidden md:inline"> – {label(shown[shown.length - 1])}</span>}
        </h2>
        <button
          onClick={() => setOffset((o) => o + 1)}
          disabled={offset === months.length - 1}
          aria-label="Next month"
          className="grid h-10 w-10 place-items-center rounded-full bg-app-surface text-xl disabled:opacity-40"
        >
          ›
        </button>
      </div>

      <div className="mt-4 grid gap-6 md:grid-cols-3">
        {shown.map(({ year, month }, i) => (
          // Phones show only the first month; laptops show all three.
          <div key={`${year}-${month}`} className={i > 0 ? "hidden md:block" : ""}>
            <MonthGrid {...props} year={year} month={month} chosen={day} onDay={setDay} phoneTitle={false} />
          </div>
        ))}
      </div>

      <p className="mt-4 min-h-[3rem] rounded-xl bg-app-surface px-4 py-3 text-sm" aria-live="polite">
        {day ? (
          <>
            <span className="font-semibold">{formatDate(day)}</span> · {describeDay(day, props)}
          </>
        ) : (
          <span className="text-app-muted">Tap a day to see what&apos;s on it.</span>
        )}
      </p>
    </div>
  );
}
