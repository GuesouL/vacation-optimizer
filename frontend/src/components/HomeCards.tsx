"use client";

import type { Window } from "@/lib/api";
import { formatRange } from "@/lib/dates";
import { ptoCost, soonest, stretch } from "@/lib/stretch";

const card = "rounded-2xl bg-app-surface p-4 shadow-sm";
const chip = "shrink-0 whitespace-nowrap rounded-full bg-app-tile px-2 py-0.5 text-xs font-medium";

/**
 * The Home hero: how many days off your PTO can turn into if you book the
 * best-value breaks. Alone it also shows a meter of booked vs planned PTO.
 */
export function StretchCard(props: {
  windows: Window[];
  budget: number; // PTO left; in a group, the lowest anyone has
  balance: number | null; // your yearly balance, for the meter (alone only)
  solo: boolean;
  onSee: () => void;
}) {
  const { picks, used, daysOff } = stretch(props.windows, props.budget);
  if (!picks.length) {
    return (
      <section className={card} aria-label="How far your PTO goes">
        <p className="text-sm text-app-muted">
          {props.budget > 0 ? "None of these breaks fit the PTO you have left." : "No PTO left to plan with this year."}
        </p>
      </section>
    );
  }
  const { balance } = props;
  const pct = (n: number) => `${balance ? Math.min(100, (n / balance) * 100) : 0}%`;
  return (
    <section className={card} aria-label="How far your PTO goes">
      <p className="text-sm text-app-muted">{props.solo ? "Your PTO can stretch to" : "Your plan's PTO can stretch to"}</p>
      <div className="mt-1 flex items-end justify-between gap-2">
        <p>
          <span className="text-5xl font-semibold tabular-nums tracking-tight">{daysOff}</span>{" "}
          <span className="text-app-muted">days off</span>
        </p>
        <span className={chip}>{(daysOff / used).toFixed(1)}× your PTO</span>
      </div>
      {props.solo && balance ? (
        // Booked days (already spent) then the planned picks, out of the year's balance.
        <div className="mt-3 flex h-2 overflow-hidden rounded-full bg-app-tile" aria-hidden="true">
          <i className="bg-app-strong" style={{ width: pct(balance - props.budget) }} />
          <i className="bg-app-accent" style={{ width: pct(used) }} />
        </div>
      ) : null}
      <p className="mt-2 text-sm text-app-muted">
        {props.solo && balance
          ? `${props.budget} of ${balance} PTO days left · using ${used} on your top ${picks.length} picks`
          : `Up to ${used} PTO each on the top ${picks.length} picks`}
      </p>
      <button onClick={props.onSee} className="mt-3 text-sm font-medium text-app-link underline">
        See those picks →
      </button>
    </section>
  );
}

/**
 * Group plans only: the next three breaks everyone can take together. A card under
 * Stretch on phones, a sidebar on laptops (the page decides where it goes).
 */
export function FreeCard(props: { windows: Window[]; people: string[]; onPick: (w: Window) => void }) {
  const next = soonest(props.windows);
  return (
    <section className={card} aria-label="Everyone's free next">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-app-muted">Everyone&apos;s free next</h2>
        <span className="flex" aria-label={props.people.join(", ")}>
          {props.people.slice(0, 4).map((name, i) => (
            <span
              key={i}
              aria-hidden="true"
              className="-ml-1.5 grid h-7 w-7 place-items-center rounded-full bg-app-tile text-xs font-semibold ring-2 ring-app-surface first:ml-0"
            >
              {name.charAt(0).toUpperCase()}
            </span>
          ))}
        </span>
      </div>
      {next.length === 0 ? (
        <p className="mt-2 text-sm text-app-muted">No break fits everyone in the next 12 months.</p>
      ) : (
        <ul className="mt-2 divide-y divide-app-line">
          {next.map((w) => {
            const cost = ptoCost(w);
            return (
              <li key={`${w.start}-${w.end}`}>
                <button onClick={() => props.onPick(w)} className="flex w-full items-center justify-between gap-2 py-2.5 text-left">
                  <span>
                    <span className="block font-medium">{formatRange(w.start, w.end)}</span>
                    <span className="block text-sm text-app-muted">{w.days} days off</span>
                  </span>
                  <span className={chip}>{cost ? `Up to ${cost} PTO` : "No PTO"}</span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
