"use client";

import { type FormEvent, useState } from "react";

import HolidayPicker from "@/components/HolidayPicker";
import { errorMessage } from "@/lib/api";
import { useFederalHolidays } from "@/lib/holidays";
import type { Profile, Renewal } from "@/lib/profile";

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const inputClass =
  "mt-1 block w-24 rounded-lg border border-app-line bg-app-surface px-3 py-2";

/**
 * Name, PTO, work week and holidays. Used by onboarding, the join page and Settings.
 * Settings passes `current` to start from what's saved.
 */
export default function ProfileForm(props: {
  nameLabel?: string; // "Your first name" unless this form is about someone else
  // skippedHolidays: null when they aren't on the federal calendar at all (= skip every one)
  current?: { ptoBalance: number; workWeek: number[]; renewal: Renewal | null; skippedHolidays: string[] | null };
  initialName: string;
  submitLabel: string;
  savingLabel: string;
  onSubmit: (profile: Profile) => Promise<void>;
}) {
  const [name, setName] = useState(props.initialName);
  const { current } = props;
  const [pto, setPto] = useState(String(current?.ptoBalance ?? 10));
  const [workWeek, setWorkWeek] = useState(current?.workWeek ?? [0, 1, 2, 3, 4]);
  const holidays = useFederalHolidays();
  // null until the list loads, for someone saved with no federal holidays at all
  const [skippedState, setSkipped] = useState<string[] | null>(current ? current.skippedHolidays : []);
  const skipped = skippedState ?? holidays.map((h) => h.name);
  const [allowance, setAllowance] = useState(current?.renewal ? String(current.renewal.allowance) : ""); // blank = skip renewal
  const [renewMonth, setRenewMonth] = useState(String(current?.renewal?.month ?? 1));
  const [renewDay, setRenewDay] = useState(String(current?.renewal?.day ?? 1));
  const [carryover, setCarryover] = useState(String(current?.renewal?.carryoverMax ?? 0));
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
      const renewal = allowance.trim()
        ? {
            allowance: Number(allowance),
            month: Number(renewMonth),
            day: Number(renewDay),
            carryoverMax: Number(carryover || 0),
          }
        : null;
      await props.onSubmit({ name: name.trim(), ptoBalance: Number(pto), workWeek, skippedHolidays: skipped, renewal });
    } catch (err) {
      setError(errorMessage(err));
      setSaving(false);
    }
  }

  return (
    <form onSubmit={submit} className="mt-8 space-y-6">
      <label className="block">
        <span className="text-sm font-medium">{props.nameLabel ?? "Your first name"}</span>
        <input
          required
          maxLength={100}
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="mt-1 block w-full rounded-lg border border-app-line bg-app-surface px-3 py-2"
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
          className="mt-1 block w-32 rounded-lg border border-app-line bg-app-surface px-3 py-2"
        />
        {current && (
          <span className="mt-1 block text-xs text-app-muted">
            Count the days you have today. Trips you&apos;ve booked in the app are taken off automatically.
          </span>
        )}
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
                    ? "bg-app-btn text-app-on-btn"
                    : "bg-app-tile text-app-muted"
                }`}
              >
                {label}
              </button>
            );
          })}
        </div>
      </fieldset>

      <HolidayPicker holidays={holidays} skipped={skipped} onChange={setSkipped} />

      <details open={!!current?.renewal} className="rounded-lg border border-app-line bg-app-surface p-3">
        <summary className="cursor-pointer text-sm font-medium">
          When does your PTO renew? <span className="font-normal text-app-muted">(optional)</span>
        </summary>
        <p className="mt-2 text-xs text-app-muted">
          Lets trips after your renewal use next year&apos;s days. Leave &quot;days per year&quot; blank
          to plan the whole year with the balance above.
        </p>
        <div className="mt-3 flex flex-wrap gap-4">
          <label className="block">
            <span className="text-sm">Days per year</span>
            <input type="number" min={0} max={365} value={allowance} onChange={(e) => setAllowance(e.target.value)} className={inputClass} />
          </label>
          <label className="block">
            <span className="text-sm">Renews on</span>
            <span className="mt-1 flex gap-1">
              <select aria-label="Renewal month" value={renewMonth} onChange={(e) => setRenewMonth(e.target.value)}
                className="rounded-lg border border-app-line bg-app-surface px-2 py-2">
                {MONTHS.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
              </select>
              <input aria-label="Renewal day" type="number" min={1} max={31} value={renewDay}
                onChange={(e) => setRenewDay(e.target.value)} className="w-16 rounded-lg border border-app-line bg-app-surface px-2 py-2" />
            </span>
          </label>
          <label className="block">
            <span className="text-sm">Days that carry over</span>
            <input type="number" min={0} max={365} value={carryover} onChange={(e) => setCarryover(e.target.value)} className={inputClass} />
          </label>
        </div>
      </details>

      {error && <ErrorNote>{error}</ErrorNote>}

      <button
        type="submit"
        disabled={saving || workWeek.length === 0}
        className="w-full rounded-lg bg-app-btn px-4 py-2.5 font-medium text-app-on-btn hover:bg-app-btn-hover disabled:opacity-50"
      >
        {saving ? props.savingLabel : props.submitLabel}
      </button>
    </form>
  );
}

export function ErrorNote({ children }: { children: React.ReactNode }) {
  return (
    <p role="alert" className="rounded-lg bg-app-danger-soft px-3 py-2 text-sm text-app-danger">
      {children}
    </p>
  );
}
