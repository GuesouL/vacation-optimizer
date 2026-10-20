"use client";

import { useEffect, useRef, useState } from "react";

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
        <p className="mt-3 text-sm font-medium text-app-muted">✓ Saved. Book it from Saved trips.</p>
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

/**
 * Phones: the break's detail in a sheet that slides up from the bottom. A native
 * <dialog> opened with showModal() gives us the dimmed backdrop, Esc to close and
 * focus kept inside for free.
 */
export function BreakSheet(props: Props & { open: boolean; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const { open, onClose, ...detail } = props;

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      onClose={onClose}
      // A tap on the backdrop lands on the <dialog> itself, not its content: close.
      onClick={(e) => e.target === e.currentTarget && onClose()}
      aria-label="Break details"
      className="m-0 mt-auto max-h-[85vh] w-full max-w-none rounded-t-2xl bg-app-surface p-0 text-foreground backdrop:bg-black/40 md:hidden"
    >
      <div className="p-4 pb-[calc(1rem+env(safe-area-inset-bottom))]">
        <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-app-line" aria-hidden="true" />
        <button onClick={onClose} className="float-right text-sm text-app-link underline">Close</button>
        <BreakDetail {...detail} />
      </div>
    </dialog>
  );
}
