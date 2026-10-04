"use client";

import {
  formatDate,
  isBetween,
  type ISODate,
  monthGrid,
  next12Months,
} from "@/lib/dates";

type Props = {
  start: ISODate;
  holidays: Map<ISODate, string>;
  workWeek: number[];
  selected: { start: ISODate; end: ISODate } | null;
};

const MONTH = new Intl.DateTimeFormat("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
const HEADERS = ["M", "T", "W", "T", "F", "S", "S"];

/** Twelve mini months. Holidays are marked, and the selected trip is shaded. */
export default function YearCalendar({ start, holidays, workWeek, selected }: Props) {
  return (
    <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
      {next12Months(start).map(({ year, month }) => (
        <section key={`${year}-${month}`} aria-label={MONTH.format(Date.UTC(year, month - 1, 1))}>
          <h3 className="mb-2 text-sm font-semibold">{MONTH.format(Date.UTC(year, month - 1, 1))}</h3>
          <div className="grid grid-cols-7 gap-0.5 text-center text-xs">
            {HEADERS.map((h, i) => (
              <div key={i} className="pb-1 text-zinc-400">{h}</div>
            ))}
            {monthGrid(year, month).flat().map((day, i) => {
              if (!day) return <div key={i} />;
              const holiday = holidays.get(day);
              const dayOff = !workWeek.includes(i % 7) || holiday;
              const inTrip = selected && isBetween(day, selected.start, selected.end);
              return (
                <div
                  key={day}
                  title={holiday ? `${formatDate(day)}: ${holiday}` : formatDate(day)}
                  className={[
                    "relative rounded py-1 tabular-nums",
                    inTrip
                      ? dayOff ? "bg-teal-600 text-white" : "bg-teal-800 font-semibold text-white"
                      : dayOff ? "bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400" : "",
                    day < start ? "opacity-30" : "",
                  ].join(" ")}
                >
                  {Number(day.slice(8))}
                  {holiday && (
                    <span className="absolute bottom-0.5 left-1/2 h-1 w-1 -translate-x-1/2 rounded-full bg-amber-500" />
                  )}
                </div>
              );
            })}
          </div>
        </section>
      ))}
    </div>
  );
}
