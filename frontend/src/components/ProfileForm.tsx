"use client";

import { type FormEvent, useState } from "react";

import { errorMessage } from "@/lib/api";
import type { Profile } from "@/lib/profile";

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

/** Name, PTO, work week and holidays. Used by onboarding and by the join page. */
export default function ProfileForm(props: {
  initialName: string;
  submitLabel: string;
  savingLabel: string;
  onSubmit: (profile: Profile) => Promise<void>;
}) {
  const [name, setName] = useState(props.initialName);
  const [pto, setPto] = useState("10");
  const [workWeek, setWorkWeek] = useState([0, 1, 2, 3, 4]);
  const [federal, setFederal] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  function toggleDay(day: number) {
    setWorkWeek((days) =>
      days.includes(day) ? days.filter((d) => d !== day) : [...days, day].sort(),
    );
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await props.onSubmit({ name: name.trim(), ptoBalance: Number(pto), workWeek, federal });
    } catch (err) {
      setError(errorMessage(err));
      setSaving(false);
    }
  }

  return (
    <form onSubmit={submit} className="mt-8 space-y-6">
      <label className="block">
        <span className="text-sm font-medium">Your first name</span>
        <input
          required
          maxLength={100}
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="mt-1 block w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 dark:border-zinc-700 dark:bg-zinc-900"
        />
      </label>

      <label className="block">
        <span className="text-sm font-medium">PTO days left this year</span>
        <input
          required
          type="number"
          min={0}
          max={365}
          value={pto}
          onChange={(e) => setPto(e.target.value)}
          className="mt-1 block w-32 rounded-lg border border-zinc-300 bg-white px-3 py-2 dark:border-zinc-700 dark:bg-zinc-900"
        />
      </label>

      <fieldset>
        <legend className="text-sm font-medium">Days you work</legend>
        <div className="mt-2 flex flex-wrap gap-2">
          {DAYS.map((label, day) => {
            const on = workWeek.includes(day);
            return (
              <button
                key={label}
                type="button"
                aria-pressed={on}
                onClick={() => toggleDay(day)}
                className={`rounded-full px-3 py-1.5 text-sm font-medium transition ${
                  on
                    ? "bg-teal-700 text-white"
                    : "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300"
                }`}
              >
                {label}
              </button>
            );
          })}
        </div>
      </fieldset>

      <label className="flex items-center gap-2">
        <input type="checkbox" checked={federal} onChange={(e) => setFederal(e.target.checked)} />
        <span className="text-sm">I get the US federal holidays off</span>
      </label>

      {error && <ErrorNote>{error}</ErrorNote>}

      <button
        type="submit"
        disabled={saving || workWeek.length === 0}
        className="w-full rounded-lg bg-teal-700 px-4 py-2.5 font-medium text-white hover:bg-teal-800 disabled:opacity-50"
      >
        {saving ? props.savingLabel : props.submitLabel}
      </button>
    </form>
  );
}

export function ErrorNote({ children }: { children: React.ReactNode }) {
  return (
    <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800 dark:bg-red-950 dark:text-red-200">
      {children}
    </p>
  );
}
