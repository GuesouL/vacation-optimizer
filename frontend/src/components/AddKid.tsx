"use client";

import { type FormEvent, useState } from "react";

import DistrictSearch from "@/components/DistrictSearch";
import { api, errorMessage } from "@/lib/api";
import type { District } from "@/lib/districts";

/** Add a child to the group and find their school district, or enter their own school's dates. */

export default function AddKid({ groupId, onAdded }: { groupId: number; onAdded: (kidId: number, enterSchedule: boolean) => void }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [district, setDistrict] = useState<District | null>(null);
  const [notListed, setNotListed] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    try {
      // Three calls: the kid, their school calendar, then into this group.
      const kid = await api.POST("/people", { body: { name: name.trim(), kind: "CHILD" } });
      if (!kid.data) throw kid.error;
      // A district with a shared calendar: just link it. Otherwise (no calendar yet,
      // or not listed) make an empty private school calendar; the schedule editor opens next.
      const shared = notListed ? null : district?.calendar;
      const custom = !shared;
      let calendarId = shared?.id ?? 0;
      if (custom) {
        const label = !notListed && district ? district.name : `${name.trim()}'s school`;
        const made = await api.POST("/calendars", { body: { name: label, kind: "SCHOOL" } });
        if (!made.data) throw made.error;
        calendarId = made.data.id;
      }
      const link = await api.POST("/people/{person_id}/calendars", {
        params: { path: { person_id: kid.data.id } },
        body: { calendar_id: calendarId },
      });
      if (link.error) throw link.error;
      const added = await api.POST("/groups/{group_id}/members", {
        params: { path: { group_id: groupId } },
        body: { person_ids: [kid.data.id] },
      });
      if (!added.data) throw added.error;
      setName("");
      setDistrict(null);
      setNotListed(false);
      setOpen(false);
      onAdded(kid.data.id, custom);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  if (!open) {
    return (
      <button onClick={() => setOpen(true)} className="mt-2 text-sm font-medium text-app-link underline">
        + Add a kid
      </button>
    );
  }

  return (
    <form onSubmit={submit} className="mt-3 space-y-2 rounded-lg border border-app-line bg-app-surface p-3 text-sm">
      <label className="block">
        <span className="font-medium">Kid&apos;s first name</span>
        <input
          required
          maxLength={100}
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="mt-1 block w-full rounded border border-app-line bg-app-surface px-2 py-1"
        />
      </label>
      <div>
        <span className="font-medium">School district</span>
        {!notListed && <DistrictSearch value={district} onChange={setDistrict} />}
        <label className="mt-1 flex items-center gap-2 text-xs">
          <input type="checkbox" checked={notListed} onChange={(e) => setNotListed(e.target.checked)} />
          My school isn&apos;t listed (private school, or I&apos;ll enter its dates)
        </label>
      </div>
      {!notListed && district && !district.calendar && (
        <p className="text-xs text-app-muted">
          Nobody has added this district&apos;s calendar yet. After you add your kid, type in the school breaks or import a calendar file.
        </p>
      )}
      {error && <p role="alert" className="text-app-danger">{error}</p>}
      <div className="flex gap-2">
        <button type="submit" disabled={saving || (!district && !notListed)} className="rounded bg-app-btn px-3 py-1.5 font-medium text-app-on-btn disabled:opacity-50">
          {saving ? "Adding…" : "Add"}
        </button>
        <button type="button" onClick={() => setOpen(false)} className="px-2 text-app-muted underline">Cancel</button>
      </div>
    </form>
  );
}
