"use client";

import { useState } from "react";

import { api, errorMessage } from "@/lib/api";
import { card } from "@/components/ui";

/**
 * Settings: the monthly email ("you have PTO, here are next month's free dates").
 * Off until you turn it on. The switch flips straight away and rolls back if the
 * server says no, so it never shows a state that didn't save.
 */
export default function ReminderToggle({ initial }: { initial: boolean }) {
  const [on, setOn] = useState(initial);
  const [error, setError] = useState<string | null>(null);

  async function change(next: boolean) {
    setOn(next);
    setError(null);
    const { error } = await api.PUT("/me/reminders", { body: { enabled: next } });
    if (error) {
      setOn(!next);
      setError(errorMessage(error));
    }
  }

  return (
    <div className={`mt-8 ${card}`}>
      <label className="flex cursor-pointer items-center justify-between gap-4">
        <span>
          <span className="block font-bold">Monthly email</span>
          <span className="block text-sm text-app-muted">
            Once a month: your PTO left and the best breaks starting next month.
          </span>
        </span>
        <input
          type="checkbox"
          role="switch"
          checked={on}
          onChange={(e) => change(e.target.checked)}
          className="peer sr-only"
        />
        <span
          aria-hidden="true"
          className={`relative h-6 w-10 shrink-0 rounded-full transition-colors peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-foreground ${on ? "bg-app-accent" : "bg-app-tile"}`}
        >
          <span className={`absolute top-1 h-4 w-4 rounded-full bg-app-surface transition-[left] motion-reduce:transition-none ${on ? "left-5" : "left-1"}`} />
        </span>
      </label>
      {error && <p role="alert" className="mt-2 text-sm text-app-danger">{error}</p>}
    </div>
  );
}
