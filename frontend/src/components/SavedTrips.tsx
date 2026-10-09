"use client";

import { useState } from "react";

import { api, errorMessage, type Trip, type Window } from "@/lib/api";
import { formatRange } from "@/lib/dates";
import { bookedBy, isSaved } from "@/lib/trips";

/**
 * Save the selected suggestion as a group trip, then book (or cancel) your
 * people's PTO for it. Saving changes nobody's PTO; booking does, so after a
 * booking change the parent re-runs the plan (`onPtoChanged`).
 */
export default function SavedTrips(props: {
  groupId: number;
  trips: Trip[];
  selected: Window | null;
  onSaved: () => void;
  onPtoChanged: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { groupId, trips, selected } = props;

  // One request at a time, and any error shows under the list.
  async function run(request: () => Promise<{ error?: unknown }>, done: () => void) {
    setBusy(true);
    setError(null);
    const { error } = await request();
    setBusy(false);
    if (error) return setError(errorMessage(error));
    done();
  }

  const path = (tripId: number) => ({ params: { path: { group_id: groupId, trip_id: tripId } } });

  const save = (w: Window) =>
    run(
      () => api.POST("/groups/{group_id}/trips", {
        params: { path: { group_id: groupId } },
        body: { start_date: w.start, end_date: w.end },
      }),
      props.onSaved,
    );
  const book = (t: Trip) => run(() => api.POST("/groups/{group_id}/trips/{trip_id}/booking", path(t.id)), props.onPtoChanged);
  const cancel = (t: Trip) => run(() => api.DELETE("/groups/{group_id}/trips/{trip_id}/booking", path(t.id)), props.onPtoChanged);
  const remove = (t: Trip) => run(() => api.DELETE("/groups/{group_id}/trips/{trip_id}", path(t.id)), props.onPtoChanged);

  return (
    <div className="mt-8">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-500">Saved trips</h2>

      {selected && !isSaved(trips, selected.start, selected.end) && (
        <button
          onClick={() => save(selected)}
          disabled={busy}
          className="mt-2 w-full rounded-xl bg-teal-700 px-4 py-2 text-sm font-medium text-white hover:bg-teal-800 disabled:opacity-50"
        >
          Save {formatRange(selected.start, selected.end)}
        </button>
      )}

      {trips.length === 0 ? (
        <p className="mt-2 text-sm text-zinc-500">Pick a suggestion and save it to keep it here.</p>
      ) : (
        <ul className="mt-2 space-y-2">
          {trips.map((t) => (
            <li key={t.id} className="rounded-xl border border-dashed border-teal-600 px-4 py-3 text-sm">
              <div className="font-medium">{t.label ?? formatRange(t.start_date, t.end_date)}</div>
              {t.label && <div className="text-zinc-500">{formatRange(t.start_date, t.end_date)}</div>}
              <div className="text-zinc-500">{bookedBy(t.booked_by)}</div>
              <div className="mt-2 flex flex-wrap gap-3">
                {t.can_book && !t.mine_booked && (
                  <button onClick={() => book(t)} disabled={busy} className="font-medium text-teal-700 underline dark:text-teal-400">
                    Book my PTO
                  </button>
                )}
                {t.can_book && t.mine_booked && (
                  <button onClick={() => cancel(t)} disabled={busy} className="text-zinc-500 underline">
                    Cancel my PTO
                  </button>
                )}
                {t.can_delete && (
                  <button onClick={() => remove(t)} disabled={busy} className="text-zinc-500 underline">
                    Delete trip
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
      {error && <p role="alert" className="mt-2 text-sm text-red-600">{error}</p>}
    </div>
  );
}
