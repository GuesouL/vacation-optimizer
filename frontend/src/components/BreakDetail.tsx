"use client";

import { useState } from "react";

import Sheet from "@/components/Sheet";
import { MonthGrid } from "@/components/YearCalendar";
import { api, errorMessage, type Trip, type Window } from "@/lib/api";
import { monthsOf, ptoDays, takeOffNote } from "@/lib/breaks";
import { describeCost } from "@/lib/costs";
import { formatRange, type ISODate } from "@/lib/dates";
import type { DayMark } from "@/lib/schedule";
import { isSaved } from "@/lib/trips";

type Props = {
  window: Window;
  groupId: number;
  trips: Trip[];
  holidays: Map<ISODate, string>;
  workWeek: number[];
  marks: Map<ISODate, DayMark>;
  onSaved: () => void;
};

/**
 * One break up close: its month(s), which days you'd take off, and a Save button.
 * A side panel on laptops; inside BreakSheet on phones.
 */
export default function BreakDetail({ window: w, groupId, trips, holidays, workWeek, marks, onSaved }: Props) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const saved = isSaved(trips, w.start, w.end);

  async function save() {
    setBusy(true);
    setError(null);
    const { error } = await api.POST("/groups/{group_id}/trips", {
      params: { path: { group_id: groupId } },
      body: { start_date: w.start, end_date: w.end },
    });
    setBusy(false);
    if (error) return setError(errorMessage(error));
    onSaved();
  }

  return (
    <div>
      <h2 className="text-lg font-semibold">{formatRange(w.start, w.end)}</h2>
      <p className="text-sm text-app-muted">{describeCost(w)}</p>
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        {monthsOf(w.start, w.end).map(({ year, month }) => (
          <MonthGrid
            key={`${year}-${month}`}
            year={year}
            month={month}
            holidays={holidays}
            workWeek={workWeek}
            selected={w}
            marks={marks}
          />
        ))}
      </div>
      <p className="mt-3 text-sm">{takeOffNote(w.days, ptoDays(w.start, w.end, workWeek, holidays))}</p>
      {saved ? (
        <p className="mt-3 text-sm font-medium text-app-muted">✓ Saved. Book it from Your trips on Home.</p>
      ) : (
        <button
          onClick={save}
          disabled={busy}
          className="mt-3 w-full rounded-xl bg-app-btn px-4 py-2.5 font-medium text-app-on-btn hover:bg-app-btn-hover disabled:opacity-50"
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
      <BreakDetail {...detail} />
    </Sheet>
  );
}
