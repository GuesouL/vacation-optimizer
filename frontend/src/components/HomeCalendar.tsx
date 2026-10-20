"use client";

import type { ReactNode } from "react";

import { MonthGrid } from "@/components/YearCalendar";
import { textLink } from "@/components/ui";
import type { ISODate } from "@/lib/dates";
import type { DayMark } from "@/lib/schedule";

const MONTH = new Intl.DateTimeFormat("en-US", { month: "long", year: "numeric", timeZone: "UTC" });

/**
 * Laptop Home, middle column: this plan's next good month, with its picks shaded and
 * its trips marked. Which month: the one the best pick starts in, else this one.
 */
export default function HomeCalendar(props: {
  start: ISODate; // today
  focus: ISODate | null; // a day in the month to show
  holidays: Map<ISODate, string>;
  workWeek: number[];
  saved: { start_date: ISODate; end_date: ISODate }[];
  picks: { start: ISODate; end: ISODate }[];
  marks: Map<ISODate, DayMark>;
  legend: ReactNode;
  onOpen: () => void;
}) {
  const [year, month] = (props.focus ?? props.start).split("-").map(Number);
  return (
    <section aria-label="Calendar preview" className="hidden content-start gap-3 md:grid">
      <div className="flex items-center justify-between gap-2">
        <h2 className="font-display text-base font-bold">{MONTH.format(Date.UTC(year, month - 1, 1))}</h2>
        <button onClick={props.onOpen} className={`text-sm ${textLink}`}>Open calendar →</button>
      </div>
      <MonthGrid
        large
        heading={false}
        year={year}
        month={month}
        start={props.start}
        holidays={props.holidays}
        workWeek={props.workWeek}
        selected={null}
        saved={props.saved}
        picks={props.picks}
        marks={props.marks}
      />
      {props.legend}
    </section>
  );
}
