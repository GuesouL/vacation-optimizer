"use client";

import { type ChangeEvent, useState } from "react";

import { api, errorMessage } from "@/lib/api";
import { formatRange } from "@/lib/dates";
import { type CalendarKind, effectLabel, type Row, skippedNote, toDrafts, toRows } from "@/lib/schedule";

const MAX_BYTES = 1_000_000; // the server refuses more than this too

/**
 * Pick an .ics file (from Google Calendar, TeamSnap, a school site...), look over what
 * we found, and save the ticked rows. Nothing is saved until you press the button.
 */
export default function IcsImport(props: { calendarId: number; kind: CalendarKind; onSaved: () => void }) {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function pick(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = ""; // so choosing the same file again still fires
    if (!file) return;
    setError(null);
    if (file.size > MAX_BYTES) return setError("That file is too big (the limit is 1 MB).");
    setBusy(true);
    try {
      const { data, error } = await api.POST("/calendars/ics-preview", {
        body: { text: await file.text(), kind: props.kind },
      });
      if (!data) throw error;
      setRows(toRows(data));
      setNote(skippedNote(data));
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  function change(index: number, patch: Partial<Row>) {
    setRows((current) => current && current.map((r, i) => (i === index ? { ...r, ...patch } : r)));
  }

  async function save() {
    if (!rows) return;
    const events = toDrafts(rows);
    if (!events.length) return setError("Tick at least one event to add.");
    setBusy(true);
    setError(null);
    const { error } = await api.POST("/calendars/{calendar_id}/events/bulk", {
      params: { path: { calendar_id: props.calendarId } },
      body: { events },
    });
    setBusy(false);
    if (error) return setError(errorMessage(error));
    setRows(null);
    props.onSaved();
  }

  const ticked = rows?.filter((r) => r.checked).length ?? 0;

  return (
    <div className="mt-4">
      <label className="block text-sm">
        <span className="font-medium">Import a calendar file (.ics)</span>
        <input
          type="file"
          accept=".ics,text/calendar"
          onChange={pick}
          disabled={busy}
          className="mt-1 block w-full text-sm file:mr-3 file:rounded file:border-0 file:bg-zinc-100 file:px-3 file:py-1.5 dark:file:bg-zinc-800"
        />
      </label>
      {error && <p role="alert" className="mt-2 text-sm text-red-700">{error}</p>}

      {rows && (
        <div className="mt-3">
          {rows.length === 0 ? (
            <p className="text-sm text-zinc-500">No all-day or dated events found in that file.</p>
          ) : (
            <ul className="max-h-72 space-y-1 overflow-y-auto rounded-lg border border-zinc-200 p-2 text-sm dark:border-zinc-800">
              {rows.map((r, i) => (
                <li key={`${r.title}-${r.start_date}-${r.end_date}`} className="flex items-start gap-2 py-1">
                  <input
                    type="checkbox"
                    checked={r.checked}
                    onChange={(e) => change(i, { checked: e.target.checked })}
                    aria-label={`Add ${r.title}`}
                    className="mt-1"
                  />
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-medium">{r.title}</div>
                    <div className="text-xs text-zinc-500">
                      {formatRange(r.start_date, r.end_date)}
                      {r.timed && " · has a time of day"}
                    </div>
                  </div>
                  <select
                    value={r.effect}
                    onChange={(e) => change(i, { effect: e.target.value as Row["effect"] })}
                    aria-label={`What ${r.title} means`}
                    className="rounded border border-zinc-300 bg-white px-1 py-0.5 text-xs dark:border-zinc-700 dark:bg-zinc-900"
                  >
                    <option value="DAY_OFF">{effectLabel("DAY_OFF", props.kind)}</option>
                    <option value="BUSY">{effectLabel("BUSY", props.kind)}</option>
                  </select>
                </li>
              ))}
            </ul>
          )}
          {note && <p className="mt-2 text-xs text-zinc-500">{note}</p>}
          <div className="mt-2 flex gap-2 text-sm">
            <button
              onClick={save}
              disabled={busy || ticked === 0}
              className="rounded bg-teal-700 px-3 py-1.5 font-medium text-white disabled:opacity-50"
            >
              Add {ticked} selected
            </button>
            <button onClick={() => setRows(null)} className="px-2 text-zinc-500 underline">Discard</button>
          </div>
        </div>
      )}
    </div>
  );
}
