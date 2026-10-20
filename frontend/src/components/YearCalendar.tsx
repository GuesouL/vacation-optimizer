"use client";

import type { DayMark } from "@/lib/schedule";
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
  saved?: { start_date: ISODate; end_date: ISODate }[];
  marks?: Map<ISODate, DayMark>; // school breaks and busy days to draw, by day
};

const MONTH = new Intl.DateTimeFormat("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
const HEADERS = ["M", "T", "W", "T", "F", "S", "S"];

type GridProps = Omit<Props, "start"> & { year: number; month: number; start?: ISODate };

/**
 * One mini month, used by the year view and by a break's detail. Holidays get a dot,
 * the selected trip is shaded (PTO days darker), saved trips are tinted, and school
 * breaks (thin pink bar) and busy days (thick red bar) show along the top. Bars and dots
 * keep a ring in the card color so they stay visible on top of a shaded trip.
 */
export function MonthGrid({ year, month, start, holidays, workWeek, selected, saved = [], marks }: GridProps) {
  const name = MONTH.format(Date.UTC(year, month - 1, 1));
  return (
    <section className="rounded-xl bg-app-surface p-3" aria-label={name}>
      <h3 className="mb-2 text-sm font-semibold">{name}</h3>
      <div className="grid grid-cols-7 gap-0.5 text-center text-xs">
        {HEADERS.map((h, i) => (
          <div key={i} className="pb-1 text-app-muted">{h}</div>
        ))}
        {monthGrid(year, month).flat().map((day, i) => {
          if (!day) return <div key={i} />;
          const holiday = holidays.get(day);
          const dayOff = !workWeek.includes(i % 7) || holiday;
          const inTrip = selected && isBetween(day, selected.start, selected.end);
          const inSaved = saved.some((t) => isBetween(day, t.start_date, t.end_date));
          const mark = marks?.get(day);
          const tooltip = [holiday ? `${formatDate(day)}: ${holiday}` : formatDate(day), ...(mark?.off ?? []), ...(mark?.busy ?? [])];
          return (
            <div
              key={day}
              title={tooltip.join("\n")}
              className={[
                "relative rounded py-1 tabular-nums",
                inTrip
                  ? dayOff ? "bg-app-accent text-app-on-accent" : "bg-app-strong font-semibold text-app-on-strong"
                  : inSaved ? "bg-app-soft font-medium text-app-soft-ink"
                  : dayOff ? "bg-app-tile text-app-muted" : "",
                start && day < start ? "opacity-30" : "",
              ].join(" ")}
            >
              {Number(day.slice(8))}
              {mark && (
                <span className="absolute inset-x-1 top-0 flex items-start gap-px">
                  {mark.off.length > 0 && <span className="h-[3px] flex-1 rounded-full bg-app-school ring-1 ring-app-surface" />}
                  {mark.busy.length > 0 && <span className="h-1 flex-1 rounded-full bg-app-busy ring-1 ring-app-surface" />}
                </span>
              )}
              {holiday && (
                <span className="absolute bottom-0.5 left-1/2 h-1 w-1 -translate-x-1/2 rounded-full bg-app-holiday ring-1 ring-app-surface" />
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}

/** Twelve mini months from `start`. */
export default function YearCalendar({ start, ...rest }: Props) {
  return (
    <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
      {next12Months(start).map(({ year, month }) => (
        <MonthGrid key={`${year}-${month}`} year={year} month={month} start={start} {...rest} />
      ))}
    </div>
  );
}
