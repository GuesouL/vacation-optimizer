"use client";

import { dayFill, type DayFill } from "@/lib/calendar";
import { formatDate, type ISODate, monthGrid, next12Months, today } from "@/lib/dates";
import type { DayMark } from "@/lib/schedule";

type Props = {
  start: ISODate;
  holidays: Map<ISODate, string>;
  workWeek: number[];
  selected: { start: ISODate; end: ISODate } | null;
  saved?: { start_date: ISODate; end_date: ISODate }[];
  picks?: { start: ISODate; end: ISODate }[]; // good breaks you haven't saved, tinted
  marks?: Map<ISODate, DayMark>; // school breaks and busy days to draw, by day
};

const MONTH = new Intl.DateTimeFormat("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
const HEADERS = ["M", "T", "W", "T", "F", "S", "S"];

type GridProps = Omit<Props, "start"> & {
  year: number;
  month: number;
  start?: ISODate;
  chosen?: ISODate | null; // the tapped day, outlined
  onDay?: (day: ISODate) => void; // makes each day a button
  phoneTitle?: boolean; // off when a heading above already names the month on phones
  large?: boolean; // the Calendar tab's full-width month: no card, bigger cells
  heading?: boolean; // false when something above already names the month
};

// Cell fills from the mockup: PTO days periwinkle, the rest of a trip marigold,
// good picks pale gold, days off the tile shade.
const FILL: Record<NonNullable<DayFill>, string> = {
  pto: "bg-app-strong font-bold text-app-on-strong",
  trip: "bg-app-accent font-bold text-app-on-accent",
  pick: "bg-app-soft font-bold text-app-soft-ink",
  off: "bg-app-tile text-app-muted",
};

/**
 * One month, used by the Calendar tab, the year view and a break's detail.
 * Holidays get a dot at the top; school breaks (thin pink bar) and busy days
 * (thicker red bar) sit along the bottom; today has a ring.
 */
export function MonthGrid({ year, month, start, holidays, workWeek, selected, saved = [], picks = [], marks, chosen, onDay, phoneTitle = true, large = false, heading = true }: GridProps) {
  const name = MONTH.format(Date.UTC(year, month - 1, 1));
  const now = today();
  return (
    <section className={large ? "" : "rounded-xl bg-app-surface p-3"} aria-label={name}>
      {heading && (
        <h3 className={`mb-2 ${large ? "font-display text-base font-bold" : "text-sm font-semibold"} ${phoneTitle ? "" : "hidden md:block"}`}>
          {name}
        </h3>
      )}
      <div className={`grid grid-cols-7 text-center tabular-nums ${large ? "gap-[3px] text-sm" : "gap-0.5 text-xs"}`}>
        {HEADERS.map((h, i) => (
          <div key={i} className="py-0.5 font-bold text-app-muted">{h}</div>
        ))}
        {monthGrid(year, month).flat().map((day, i) => {
          if (!day) return <div key={i} />;
          const holiday = holidays.get(day);
          const fill = dayFill(day, { holidays, workWeek, selected, saved, picks });
          const mark = marks?.get(day);
          const tooltip = [holiday ? `${formatDate(day)}: ${holiday}` : formatDate(day), ...(mark?.off ?? []), ...(mark?.busy ?? [])];
          const Cell = onDay ? "button" : "div";
          return (
            <Cell
              key={day}
              title={tooltip.join("\n")}
              {...(onDay && { type: "button" as const, onClick: () => onDay(day), "aria-pressed": chosen === day })}
              className={[
                "relative",
                large ? "rounded-[7px] pb-[0.6rem] pt-[0.55rem]" : "rounded py-1",
                fill ? FILL[fill] : "",
                start && day < start ? "opacity-30" : "",
                day === now ? "shadow-[inset_0_0_0_1.5px_var(--foreground)]" : "",
                chosen === day ? "outline-2 -outline-offset-2 outline-foreground" : "",
              ].join(" ")}
            >
              {Number(day.slice(8))}
              {holiday && (
                <span className="absolute left-1/2 top-0.5 h-[5px] w-[5px] -translate-x-1/2 rounded-full bg-app-holiday" />
              )}
              {mark && (
                <span className="absolute inset-x-[3px] bottom-px flex items-end gap-px">
                  {mark.off.length > 0 && <span className="h-[3px] flex-1 rounded-sm bg-app-school" />}
                  {mark.busy.length > 0 && <span className="h-1 flex-1 rounded-sm bg-app-busy" />}
                </span>
              )}
            </Cell>
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
