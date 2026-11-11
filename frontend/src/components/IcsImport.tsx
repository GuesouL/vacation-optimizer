"use client";

import { type ChangeEvent, useState } from "react";

import { api, errorMessage } from "@/lib/api";
import { formatRange } from "@/lib/dates";
import { isPdf, MAX_PDF_BYTES, pdfNote, toBase64 } from "@/lib/pdf";
import { type CalendarKind, effectLabel, type Row, skippedNote, toDrafts, toRows } from "@/lib/schedule";

const MAX_BYTES = 1_000_000; // the server refuses more than this too

/**
 * Pick an .ics file (from Google Calendar, TeamSnap, a school site...) or a PDF school
 * calendar, look over what we found, and save the ticked rows. Nothing is saved until
 * you press the button.
 */
export default function IcsImport(props: { calendarId: number; kind: CalendarKind; onSaved: () => void }) {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState<string | null>(null); // what we're doing, while we do it
  const [error, setError] = useState<string | null>(null);

  async function pick(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = ""; // so choosing the same file again still fires
    if (!file) return;
    setError(null);
    const pdf = isPdf(file);
    if (pdf && file.size > MAX_PDF_BYTES) return setError("That PDF is too big (the limit is 5 MB).");
    if (!pdf && file.size > MAX_BYTES) return setError("That file is too big (the limit is 1 MB).");
    setBusy(pdf ? "Reading your calendar… a scanned PDF can take up to 30 seconds." : "Reading…");
    try {
      if (pdf) {
        const { data, error } = await api.POST("/calendars/pdf-preview", {
          body: { data_base64: toBase64(await file.arrayBuffer()), kind: props.kind },
        });
        if (!data) throw error;
        setRows(toRows(data));
        setNote(pdfNote(data));
      } else {
        const { data, error } = await api.POST("/calendars/ics-preview", {
          body: { text: await file.text(), kind: props.kind },
        });
        if (!data) throw error;
        setRows(toRows(data));
        setNote(skippedNote(data));
      }
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(null);
    }
  }

  function change(index: number, patch: Partial<Row>) {
    setRows((current) => current && current.map((r, i) => (i === index ? { ...r, ...patch } : r)));
  }

  async function save() {
    if (!rows) return;
    const events = toDrafts(rows);
    if (!events.length) return setError("Tick at least one event to add.");
    setBusy("Saving…");
    setError(null);
    const { error } = await api.POST("/calendars/{calendar_id}/events/bulk", {
      params: { path: { calendar_id: props.calendarId } },
      body: { events },
    });
    setBusy(null);
    if (error) return setError(errorMessage(error));
    setRows(null);
    props.onSaved();
  }

  const ticked = rows?.filter((r) => r.checked).length ?? 0;

  return (
    <div className="mt-4">
      <label className="block text-sm">
        <span className="font-medium">Import a calendar file (.ics or PDF)</span>
        <input
          type="file"
          accept=".ics,text/calendar,.pdf,application/pdf"
          onChange={pick}
          disabled={!!busy}
          className="mt-1 block w-full text-sm file:mr-3 file:rounded file:border-0 file:bg-app-tile file:px-3 file:py-1.5"
        />
      </label>
      {busy && <p role="status" className="mt-2 text-sm text-app-muted">{busy}</p>}
      {error && <p role="alert" className="mt-2 text-sm text-app-danger">{error}</p>}

      {rows && (
        <div className="mt-3">
          {rows.length === 0 ? (
            <p className="text-sm text-app-muted">No dates found in that file.</p>
          ) : (
            <ul className="max-h-72 space-y-1 overflow-y-auto rounded-lg border border-app-line bg-app-surface p-2 text-sm">
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
                    <div className="text-xs text-app-muted">
                      {formatRange(r.start_date, r.end_date)}
                      {r.timed && " · has a time of day"}
                    </div>
                  </div>
                  <select
                    value={r.effect}
                    onChange={(e) => change(i, { effect: e.target.value as Row["effect"] })}
                    aria-label={`What ${r.title} means`}
                    className="rounded border border-app-line bg-app-surface px-1 py-0.5 text-xs"
                  >
                    <option value="DAY_OFF">{effectLabel("DAY_OFF", props.kind)}</option>
                    <option value="BUSY">{effectLabel("BUSY", props.kind)}</option>
                    {(props.kind === "SCHOOL" || r.effect === "NOTE") && <option value="NOTE">{effectLabel("NOTE", props.kind)}</option>}
                  </select>
                </li>
              ))}
            </ul>
          )}
          {note && <p className="mt-2 text-xs text-app-muted">{note}</p>}
          <div className="mt-2 flex gap-2 text-sm">
            <button
              onClick={save}
              disabled={!!busy || ticked === 0}
              className="rounded bg-app-btn px-3 py-1.5 font-medium text-app-on-btn disabled:opacity-50"
            >
              Add {ticked} selected
            </button>
            <button onClick={() => setRows(null)} className="px-2 text-app-muted underline">Discard</button>
          </div>
        </div>
      )}
    </div>
  );
}
