"use client";

import { useMemo, type ReactNode } from "react";

import { thanksgivingExample, type DayKind } from "@/lib/bridge";
import { formatDate, today } from "@/lib/dates";

/**
 * The signed-out home page: show one real bridge, then how it works.
 * Static on purpose: no API call, so a first visit never wakes the backend.
 */

const btn =
  "rounded-xl bg-app-btn px-7 py-3.5 text-center text-[17px] font-semibold text-app-on-btn hover:bg-app-btn-hover";

const CELL: Record<DayKind, string> = {
  pto: "bg-app-strong text-app-on-strong",
  holiday: "bg-app-soft text-app-soft-ink",
  off: "bg-app-soft text-app-soft-ink",
  weekend: "bg-app-tile text-app-muted",
  work: "text-app-muted",
};
const SPOKEN: Partial<Record<DayKind, string>> = { pto: "PTO", holiday: "Thanksgiving", off: "day off" };
const WEEKDAYS = [["M", "Monday"], ["T", "Tuesday"], ["W", "Wednesday"], ["T", "Thursday"], ["F", "Friday"], ["S", "Saturday"], ["S", "Sunday"]];

const STEPS = [
  ["Tell us your PTO", "How many days you get and when they renew. We already know the federal holidays."],
  ["Add your people", "A partner, kids and their school calendar, or a .ics file of busy days. Or invite someone with a link."],
  ["Pick a break and book it", "Breaks are ranked by days off per PTO day. Save a few, then book one as a trip."],
];

const ALSO: [ReactNode, string, string][] = [
  [<><path d="M4 18a8 8 0 1 1 16 0" /><path d="M12 18l4-6" /></>, "PTO left", "after every booked trip"],
  [<><path d="M5 12h14" /><path d="M15 8l4 4-4 4" /><path d="M9 8L5 12l4 4" /></>, "Stretch a trip", "by a day on either end"],
  [<><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M3 10h18" /></>, "School and busy bars", "on the calendar"],
  [<><rect x="3" y="5" width="18" height="14" rx="2" /><path d="M3 7l9 6 9-6" /></>, "Monthly email", "with your PTO left"],
];

function Icon({ children }: { children: ReactNode }) {
  return (
    <svg aria-hidden="true" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-app-link">
      {children}
    </svg>
  );
}

function Swatch({ className, label }: { className: string; label: string }) {
  return (
    <span className="flex items-center gap-1.5">
      <span className={`inline-block ${className}`} />
      {label}
    </span>
  );
}

function BridgeExample() {
  const ex = useMemo(() => thanksgivingExample(today()), []);
  return (
    <section aria-labelledby="example" className="flex flex-col gap-4 rounded-3xl bg-app-surface p-4 md:p-6">
      <div className="flex flex-col gap-0.5">
        <p className="text-[13px] font-semibold uppercase tracking-wide text-app-muted">Example: Thanksgiving {ex.year}</p>
        <h2 id="example" className="font-display text-[28px] font-bold leading-tight md:text-[32px]">
          {ex.ptoDays} PTO days, {ex.daysOff} days off
        </h2>
        <p className="text-[15px] text-app-muted md:text-base">
          {formatDate(ex.start)} to {formatDate(ex.end)}
        </p>
      </div>
      <table className="w-full table-fixed border-separate border-spacing-1 md:border-spacing-1.5">
        <caption className="sr-only">November {ex.year} around Thanksgiving</caption>
        <thead>
          <tr>
            {WEEKDAYS.map(([short, long], i) => (
              <th key={i} scope="col" abbr={long} className="text-xs font-semibold text-app-muted">{short}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {ex.weeks.map((week) => (
            <tr key={week[0].date}>
              {week.map(({ date, kind }) => (
                <td key={date} className={`h-10 rounded-lg text-center text-sm font-medium md:h-[52px] md:text-base ${CELL[kind]}`}>
                  <span className="flex flex-col items-center">
                    {Number(date.slice(8))}
                    {kind === "holiday" && <span aria-hidden="true" className="mt-0.5 size-1.5 rounded-full bg-app-holiday" />}
                  </span>
                  {SPOKEN[kind] && <span className="sr-only">, {SPOKEN[kind]}</span>}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      <div className="flex flex-wrap gap-x-4 gap-y-2 text-[13px] text-app-muted md:text-sm">
        <Swatch className="size-3 rounded-[3px] bg-app-strong" label="PTO you spend" />
        <Swatch className="size-3 rounded-[3px] border border-app-line bg-app-soft" label="Free day off" />
        <Swatch className="size-2 rounded-full bg-app-holiday" label="Holiday" />
      </div>
    </section>
  );
}

export default function Landing({ onSignIn }: { onSignIn: () => void }) {
  return (
    <div className="flex w-full flex-col">
      <header className="mx-auto flex w-full max-w-5xl items-center justify-between px-5 pt-12 md:border-b md:border-app-line md:px-6 md:py-5">
        <p className="font-display text-4xl font-bold tracking-tight md:text-2xl">BridgeDay</p>
        <button onClick={onSignIn} className="hidden rounded-lg bg-app-btn px-4 py-2.5 font-semibold text-app-on-btn hover:bg-app-btn-hover md:block">
          Sign in
        </button>
      </header>

      <main className="mx-auto flex w-full max-w-5xl flex-col gap-7 px-5 pb-10 pt-3 md:gap-16 md:px-6 md:pt-16">
        <section className="grid gap-7 md:grid-cols-2 md:items-center md:gap-12">
          <div className="flex flex-col gap-3 md:gap-4">
            <h1 className="text-lg leading-snug text-app-muted md:font-display md:text-[52px] md:font-bold md:leading-[1.05] md:tracking-tight md:text-foreground">
              Find the most days off for the fewest PTO days.
            </h1>
            <p className="hidden text-[19px] leading-normal text-app-muted md:block">
              Spend PTO on the days that bridge a holiday to a weekend, and a 4 day spend turns into 9 days away.
            </p>
            <button onClick={onSignIn} className={`mt-3 md:self-start ${btn}`}>Sign in to start</button>
          </div>
          <BridgeExample />
        </section>

        <section aria-labelledby="how" className="flex flex-col gap-3.5 md:gap-5">
          <h2 id="how" className="font-display text-[22px] font-bold md:text-3xl">How it works</h2>
          <ol className="grid gap-3 md:grid-cols-3 md:gap-4">
            {STEPS.map(([title, body], i) => (
              <li key={title} className="flex gap-3.5 rounded-2xl bg-app-surface p-4 md:flex-col md:gap-2.5 md:p-6">
                <span aria-hidden="true" className="flex size-8 shrink-0 items-center justify-center rounded-full bg-app-accent font-bold text-app-on-accent md:size-9">
                  {i + 1}
                </span>
                <div className="flex flex-col gap-1">
                  <h3 className="text-[17px] font-semibold md:mt-1 md:text-lg">{title}</h3>
                  <p className="text-[15px] leading-relaxed text-app-muted">{body}</p>
                </div>
              </li>
            ))}
          </ol>
        </section>

        <section aria-labelledby="also" className="flex flex-col gap-2.5 md:gap-4">
          <h2 id="also" className="font-display text-[22px] font-bold md:text-2xl">Also in BridgeDay</h2>
          <ul className="divide-y divide-app-line rounded-2xl bg-app-surface md:grid md:grid-cols-4 md:gap-3 md:divide-y-0 md:bg-transparent">
            {ALSO.map(([icon, bold, rest]) => (
              <li key={bold} className="flex items-center gap-3 px-4 py-3.5 text-[15px] md:flex-col md:items-start md:gap-2 md:rounded-2xl md:bg-app-surface md:p-4">
                <Icon>{icon}</Icon>
                <span><b className="font-semibold">{bold}</b> {rest}</span>
              </li>
            ))}
          </ul>
        </section>

        <section className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between md:rounded-2xl md:bg-app-surface md:px-8 md:py-7">
          <h2 className="hidden font-display text-[26px] font-bold md:block">Your next bridge is already on the calendar.</h2>
          <button onClick={onSignIn} className={btn}>Sign in to find yours</button>
          <p className="text-center text-[13px] text-app-muted md:hidden">Example uses US federal holidays only.</p>
        </section>
      </main>
    </div>
  );
}
