"use client";

import { useState } from "react";

import Sheet from "@/components/Sheet";
import { card, chip, chipDim, chipSolid, listCard, sectionHead, textLink } from "@/components/ui";
import { api, errorMessage, type Trip, type Window } from "@/lib/api";
import { whyText } from "@/lib/breaks";
import { describeCost } from "@/lib/costs";
import { formatRange, type ISODate } from "@/lib/dates";
import type { DayMark } from "@/lib/schedule";
import { ptoCost, soonest, stretch } from "@/lib/stretch";
import { bookedBy } from "@/lib/trips";

/** "Nov 26 – Nov 29": the short range the mockup's cards use (no weekday). */
const SHORT = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
const short = (iso: ISODate) => SHORT.format(new Date(`${iso}T00:00:00Z`));
const shortRange = (w: { start: ISODate; end: ISODate }) => `${short(w.start)} – ${short(w.end)}`;

/**
 * The Home hero: how many days off your PTO can turn into if you book the
 * best-value breaks. Alone it also shows a meter of booked vs planned PTO.
 */
export function StretchCard(props: {
  windows: Window[];
  budget: number; // PTO left; in a group, the lowest anyone has
  balance: number | null; // your yearly balance, for the meter
  left: number | null; // your own PTO left: balance minus what's booked
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
          <span className="font-display text-6xl font-bold leading-none tabular-nums">{daysOff}</span>{" "}
          <span className="text-sm text-app-muted">days off</span>
        </p>
        <span className={chip}>{(daysOff / used).toFixed(1)}× your PTO</span>
      </div>
      {balance && props.left != null ? (
        // Your booked days (already spent) then the planned picks, out of your year's balance.
        <div className="mt-3 flex h-2 overflow-hidden rounded bg-app-tile" aria-hidden="true">
          <i className="bg-app-strong" style={{ width: pct(balance - props.left) }} />
          <i className="bg-app-accent" style={{ width: pct(used) }} />
        </div>
      ) : null}
      <p className="mt-2 text-sm text-app-muted">
        {props.solo && balance
          ? `${props.budget} of ${balance} PTO days left · using ${used} on your top ${picks.length} picks`
          : `Up to ${used} PTO each on the top ${picks.length} picks`}
      </p>
      <button onClick={props.onSee} className={`mt-2 text-sm ${textLink}`}>See those picks →</button>
    </section>
  );
}

function Avatars({ names }: { names: string[] }) {
  return (
    <span className="flex" aria-label={names.join(", ")}>
      {names.slice(0, 4).map((name, i) => (
        <span
          key={i}
          aria-hidden="true"
          className="-ml-1.5 grid h-6 w-6 place-items-center rounded-full border-2 border-app-surface bg-app-soft text-[0.62rem] font-bold text-app-soft-ink first:ml-0"
        >
          {name.charAt(0).toUpperCase()}
        </span>
      ))}
    </span>
  );
}

/**
 * Group plans only: the next break everyone can take together, and why it works.
 * "2 more" opens the next ones. A card under Stretch on phones, a sidebar on laptops.
 */
export function FreeCard(props: {
  windows: Window[];
  people: string[];
  holidays: Map<ISODate, string>;
  marks: Map<ISODate, DayMark>;
  onPick: (w: Window) => void;
}) {
  const [more, setMore] = useState(false);
  const next = soonest(props.windows);
  const why = (w: Window) => whyText(w.start, w.end, props.holidays, props.marks) ?? `${w.days} days off`;
  const cost = (w: Window) => (ptoCost(w) ? `${ptoCost(w)} PTO each` : "No PTO");
  const first = next[0];

  return (
    <section className={card} aria-label="Everyone's free next">
      <div className="flex items-center justify-between gap-2">
        <h2 className={sectionHead}>Everyone&apos;s free next</h2>
        <Avatars names={props.people} />
      </div>
      {!first ? (
        <p className="mt-2 text-sm text-app-muted">No break fits everyone in the next 12 months.</p>
      ) : (
        <>
          <button onClick={() => props.onPick(first)} className="mt-2 flex w-full items-center justify-between gap-2 text-left">
            <span className="font-bold">{shortRange(first)}</span>
            <span className={chip}>{cost(first)}</span>
          </button>
          <p className="mt-1 text-sm text-app-muted">
            {why(first)}
            {next.length > 1 && (
              <>
                {" · "}
                <button onClick={() => setMore(true)} className={textLink}>{next.length - 1} more →</button>
              </>
            )}
          </p>
        </>
      )}

      <Sheet open={more} onClose={() => setMore(false)} label="Everyone's free">
        <h2 className="font-display text-lg font-bold">Everyone&apos;s free</h2>
        <p className="text-sm text-app-muted">The next {next.length} breaks when {props.people.join(", ")} are all off.</p>
        <ul className={`mt-3 ${listCard}`}>
          {next.map((w) => (
            <li key={`${w.start}-${w.end}`}>
              <button
                onClick={() => {
                  setMore(false);
                  props.onPick(w);
                }}
                className="flex w-full items-center justify-between gap-2 px-4 py-3 text-left"
              >
                <span>
                  <span className="block font-bold">{shortRange(w)}</span>
                  <span className="block text-sm text-app-muted">{why(w)}</span>
                </span>
                <span className={ptoCost(w) ? chip : chipDim}>{cost(w)}</span>
              </button>
            </li>
          ))}
        </ul>
      </Sheet>
    </section>
  );
}

/**
 * Your saved and booked trips. Tap one for its sheet: book your PTO, cancel the
 * booking, or delete it. Booking changes PTO, so the parent re-ranks after (`onPtoChanged`).
 */
export function TripsCard(props: { groupId: number; trips: Trip[]; onPtoChanged: () => void }) {
  const [openId, setOpenId] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const trip = props.trips.find((t) => t.id === openId);

  async function run(request: () => Promise<{ error?: unknown }>) {
    setBusy(true);
    setError(null);
    const { error } = await request();
    setBusy(false);
    if (error) return setError(errorMessage(error));
    setOpenId(null);
    props.onPtoChanged();
  }
  const path = (t: Trip) => ({ params: { path: { group_id: props.groupId, trip_id: t.id } } });
  const button = "mt-2 w-full rounded-xl px-4 py-2.5 font-medium disabled:opacity-50";

  return (
    <section aria-label="Your trips">
      <h2 className={sectionHead}>Your trips</h2>
      {props.trips.length === 0 ? (
        <p className="mt-2 text-sm text-app-muted">No trips yet. Open a break and save it to keep it here.</p>
      ) : (
        <ul className={`mt-2 ${listCard}`}>
          {props.trips.map((t) => (
            <li key={t.id}>
              <button onClick={() => setOpenId(t.id)} className="flex w-full items-center justify-between gap-2 px-4 py-3 text-left">
                <span>
                  <span className="block font-bold">{t.label ?? (t.booked_by.length ? "Booked trip" : "Saved trip")}</span>
                  <span className="block text-sm text-app-muted">{shortRange({ start: t.start_date, end: t.end_date })}</span>
                </span>
                <span className={t.booked_by.length ? chipSolid : chip}>{t.booked_by.length ? "Booked" : "Saved"}</span>
              </button>
            </li>
          ))}
        </ul>
      )}

      <Sheet open={!!trip} onClose={() => setOpenId(null)} label="Trip details">
        {trip && (
          <div>
            <h2 className="font-display text-lg font-bold">{trip.label ?? formatRange(trip.start_date, trip.end_date)}</h2>
            <p className="text-sm text-app-muted">
              {trip.label ? `${formatRange(trip.start_date, trip.end_date)} · ` : ""}
              {bookedBy(trip.booked_by)}
            </p>
            <p className="mt-3 text-sm">
              {trip.mine_booked
                ? "Your PTO for this trip is booked, and your balance already counts it."
                : "Saved, not booked. Booking takes the PTO from everyone you manage who's going."}
            </p>
            {trip.can_book && !trip.mine_booked && (
              <button disabled={busy} onClick={() => run(() => api.POST("/groups/{group_id}/trips/{trip_id}/booking", path(trip)))}
                className={`${button} bg-app-btn text-app-on-btn hover:bg-app-btn-hover`}>
                Book my PTO
              </button>
            )}
            {trip.can_book && trip.mine_booked && (
              <button disabled={busy} onClick={() => run(() => api.DELETE("/groups/{group_id}/trips/{trip_id}/booking", path(trip)))}
                className={`${button} border border-app-line text-app-danger`}>
                Cancel my booking
              </button>
            )}
            {trip.can_delete && (
              <button disabled={busy} onClick={() => run(() => api.DELETE("/groups/{group_id}/trips/{trip_id}", path(trip)))}
                className={`${button} border border-app-line text-app-danger`}>
                Delete trip
              </button>
            )}
            {error && <p role="alert" className="mt-2 text-sm text-app-danger">{error}</p>}
          </div>
        )}
      </Sheet>
    </section>
  );
}

/** The single best break you haven't saved yet. */
export function BestPickCard(props: { window: Window | undefined; empty: string; onPick: (w: Window) => void }) {
  const w = props.window;
  return (
    <section aria-label="Best next pick">
      <h2 className={sectionHead}>Best next pick</h2>
      {!w ? (
        <p className="mt-2 text-sm text-app-muted">{props.empty}</p>
      ) : (
        <button onClick={() => props.onPick(w)} className={`mt-2 block w-full text-left ${card}`}>
          <span className="flex items-center justify-between gap-2">
            <span className="font-bold">{shortRange(w)}</span>
            <span className={chip}>{w.days} days</span>
          </span>
          <span className="mt-0.5 block text-sm text-app-muted">{describeCost(w)}</span>
        </button>
      )}
    </section>
  );
}
