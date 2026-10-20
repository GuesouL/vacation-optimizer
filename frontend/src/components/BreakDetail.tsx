"use client";

import { useState } from "react";

import Sheet from "@/components/Sheet";
import { MonthGrid } from "@/components/YearCalendar";
import { api, errorMessage, type Group, type PersonSchedule, type Trip, type Window } from "@/lib/api";
import { daysIn, monthsOf, ptoDays, stretchTo, takeOffNote, whyText } from "@/lib/breaks";
import { addDays, formatRange, type ISODate } from "@/lib/dates";
import { ptoCost } from "@/lib/stretch";
import { chip } from "@/components/ui";
import type { DayMark } from "@/lib/schedule";
import { isSaved } from "@/lib/trips";
import { whoIsFree } from "@/lib/whofree";

type Props = {
  window: Window;
  groupId: number;
  trips: Trip[];
  holidays: Map<ISODate, string>;
  workWeek: number[];
  marks: Map<ISODate, DayMark>;
  onSaved: () => void;
  onSeeHome: () => void; // after saving: take me to the trip on Home
  earliest: ISODate; // today: a stretched trip can't start before it
  people: Group["people"]; // for "Who's free"
  schedules: PersonSchedule[];
};

/**
 * One break up close: its month(s), which days you'd take off, and a Save button.
 * A side panel on laptops; inside BreakSheet on phones.
 */
export default function BreakDetail({ window: w, groupId, trips, holidays, workWeek, marks, onSaved, onSeeHome, earliest, people, schedules }: Props) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // The dates you'd save: the suggestion, or the suggestion stretched with extra PTO days.
  const [range, setRange] = useState({ start: w.start, end: w.end });
  const stretched = range.start !== w.start || range.end !== w.end;
  const days = daysIn(range.start, range.end).length;
  const pto = ptoDays(range.start, range.end, workWeek, holidays);
  const saved = isSaved(trips, range.start, range.end);
  const suggestedPto = ptoDays(w.start, w.end, workWeek, holidays).length;
  const extraPto = (n: number) => (n === suggestedPto ? "same as the suggestion" : `${n - suggestedPto} more than the suggestion`);
  const stretch = (day: ISODate) => setRange((r) => stretchTo(r, day, w, earliest));

  async function save() {
    setBusy(true);
    setError(null);
    const { error } = await api.POST("/groups/{group_id}/trips", {
      params: { path: { group_id: groupId } },
      body: { start_date: range.start, end_date: range.end },
    });
    setBusy(false);
    if (error) return setError(errorMessage(error));
    onSaved();
  }

  const why = whyText(w.start, w.end, holidays, marks);
  const who = whoIsFree(
    range,
    w,
    people.map((p) => ({ id: p.id, name: p.name, kind: p.kind, mine: p.mine, workWeek: p.work_week })),
    schedules,
    holidays,
  );
  // The headline cost: the search's number for the suggestion, your own work week once stretched.
  const costChip = `${stretched ? pto.length : ptoCost(w)} PTO → ${days} days off`;

  return (
    <div>
      <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1">
        <div>
          <h2 className="font-display text-xl font-bold md:text-[1.6rem] md:leading-tight">{formatRange(range.start, range.end)}</h2>
          <p className="text-sm text-app-muted">{why ?? `${days} days off`}</p>
        </div>
        <span className={`${chip} mt-1`}>{costChip}</span>
      </div>
      {stretched && (
        // Only your own work week is known here, so a stretched trip shows your cost.
        <p className="mt-1 text-sm text-app-muted">{`${pto.length} of your PTO days, ${extraPto(pto.length)}`}</p>
      )}
      <div className={`mt-3 grid gap-4 ${monthsOf(range.start, range.end).length > 1 ? "md:grid-cols-2" : "md:max-w-sm"}`}>
        {monthsOf(range.start, range.end).map(({ year, month }) => (
          <MonthGrid
            key={`${year}-${month}`}
            large
            year={year}
            month={month}
            holidays={holidays}
            workWeek={workWeek}
            selected={range}
            marks={marks}
            onDay={saved ? undefined : stretch}
          />
        ))}
      </div>
      <p className="mt-3 text-sm">{takeOffNote(days, pto)}</p>
      <p className="mt-2 text-sm">
        <b className="font-bold">Who&apos;s free:</b>{" "}
        {who.map((r) => (
          <span key={r.name} className="mr-3 inline-block whitespace-nowrap">
            <span aria-hidden="true" className={`font-bold ${r.ok === false ? "text-app-busy" : r.ok ? "text-app-school" : "text-app-muted"}`}>
              {r.ok === false ? "✗" : r.ok ? "✓" : "?"}
            </span>
            <span className="sr-only">{r.ok === false ? " Not free:" : r.ok ? " Free:" : " Not checked:"}</span>{" "}
            {r.name}
            {r.note && <span className="text-app-muted"> ({r.note})</span>}
          </span>
        ))}
      </p>
      {!saved && (
        // Want a longer trip than the best-value pick? Add PTO days on either side.
        <div className="mt-3">
          <p className="text-xs text-app-muted">Want a longer trip? Tap a day on the calendar, or:</p>
          <div className="mt-1.5 flex flex-wrap gap-2 text-sm">
            <button onClick={() => stretch(addDays(range.start, -1))} className="rounded-full border border-app-line px-3 py-1.5 font-medium">
              ＋ Day before
            </button>
            <button onClick={() => stretch(addDays(range.end, 1))} className="rounded-full border border-app-line px-3 py-1.5 font-medium">
              ＋ Day after
            </button>
            {stretched && (
              <button onClick={() => setRange({ start: w.start, end: w.end })} className="px-2 py-1.5 font-semibold text-app-soft-ink">
                Reset
              </button>
            )}
          </div>
        </div>
      )}
      {saved ? (
        // The mockup's confirmation: the button turns into a way to find the trip.
        <>
          <p role="status" className="mt-3 text-sm font-medium">✓ Saved to Your trips. Book your PTO from there.</p>
          <button
            onClick={onSeeHome}
            className="mt-2 w-full rounded-xl border border-app-line px-4 py-2.5 font-medium md:max-w-64"
          >
            See it on Home
          </button>
        </>
      ) : (
        <button
          onClick={save}
          disabled={busy}
          className="mt-3 w-full rounded-xl bg-app-btn px-4 py-2.5 font-semibold text-app-on-btn hover:bg-app-btn-hover disabled:opacity-50 md:max-w-64"
        >
          {busy ? "Saving…" : "Save this trip"}
        </button>
      )}
      {error && <p role="alert" className="mt-2 text-sm text-app-danger">{error}</p>}
    </div>
  );
}

/** Phones: the break's detail in a sheet. Laptops show it in the Breaks side panel instead. */
export function BreakSheet(props: Props & { open: boolean; onClose: () => void }) {
  const { open, onClose, ...detail } = props;
  return (
    <Sheet open={open} onClose={onClose} label="Break details" className="md:hidden">
      <BreakDetail key={`${detail.window.start}-${detail.window.end}`} {...detail} />
    </Sheet>
  );
}
