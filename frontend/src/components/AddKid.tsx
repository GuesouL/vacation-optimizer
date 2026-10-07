"use client";

import { type FormEvent, useEffect, useState } from "react";

import { api, errorMessage } from "@/lib/api";

type School = { id: number; name: string };

/** Add a child to the group and pick their school district's calendar. */
export default function AddKid({ groupId, onAdded }: { groupId: number; onAdded: () => void }) {
  const [open, setOpen] = useState(false);
  const [schools, setSchools] = useState<School[]>([]);
  const [name, setName] = useState("");
  const [schoolId, setSchoolId] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    api
      .GET("/calendars", { params: { query: { kind: "SCHOOL" } } })
      .then(({ data, error }) => {
        if (!data) throw error;
        setSchools(data);
        setSchoolId((current) => current || String(data[0]?.id ?? ""));
      })
      .catch((err) => setError(errorMessage(err)));
  }, [open]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    try {
      // Three calls: the kid, their school calendar, then into this group.
      const kid = await api.POST("/people", { body: { name: name.trim(), kind: "CHILD" } });
      if (!kid.data) throw kid.error;
      const link = await api.POST("/people/{person_id}/calendars", {
        params: { path: { person_id: kid.data.id } },
        body: { calendar_id: Number(schoolId) },
      });
      if (link.error) throw link.error;
      const added = await api.POST("/groups/{group_id}/members", {
        params: { path: { group_id: groupId } },
        body: { person_ids: [kid.data.id] },
      });
      if (!added.data) throw added.error;
      setName("");
      setOpen(false);
      onAdded();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  if (!open) {
    return (
      <button onClick={() => setOpen(true)} className="mt-2 text-sm font-medium text-teal-700 underline dark:text-teal-400">
        + Add a kid
      </button>
    );
  }

  return (
    <form onSubmit={submit} className="mt-3 space-y-2 rounded-lg border border-zinc-200 p-3 text-sm dark:border-zinc-800">
      <label className="block">
        <span className="font-medium">Kid&apos;s first name</span>
        <input
          required
          maxLength={100}
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="mt-1 block w-full rounded border border-zinc-300 bg-white px-2 py-1 dark:border-zinc-700 dark:bg-zinc-900"
        />
      </label>
      <label className="block">
        <span className="font-medium">School district</span>
        <select
          required
          value={schoolId}
          onChange={(e) => setSchoolId(e.target.value)}
          className="mt-1 block w-full rounded border border-zinc-300 bg-white px-2 py-1 dark:border-zinc-700 dark:bg-zinc-900"
        >
          {schools.map((s) => (
            <option key={s.id} value={s.id}>{s.name}</option>
          ))}
        </select>
      </label>
      <p className="text-xs text-zinc-500">Only NYC for now. More districts are coming.</p>
      {error && <p role="alert" className="text-red-700">{error}</p>}
      <div className="flex gap-2">
        <button type="submit" disabled={saving || !schoolId} className="rounded bg-teal-700 px-3 py-1.5 font-medium text-white disabled:opacity-50">
          {saving ? "Adding…" : "Add"}
        </button>
        <button type="button" onClick={() => setOpen(false)} className="px-2 text-zinc-500 underline">Cancel</button>
      </div>
    </form>
  );
}
