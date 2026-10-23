"use client";

import type { Holiday } from "@/lib/api";
import { PRESETS, presetOf, skippedFor } from "@/lib/holidays";

const shortDate = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" });

/**
 * "Which federal holidays do you get off?" One switch for the common answer
 * (all of them). Turning it off shows presets and a box per holiday; the boxes
 * are the real answer, the presets just tick them.
 */
export default function HolidayPicker(props: {
  holidays: Holiday[]; // each federal holiday once, on its next date
  skipped: string[];
  onChange: (skipped: string[]) => void;
}) {
  const { holidays, skipped, onChange } = props;
  const names = holidays.map((h) => h.name);
  const all = skipped.length === 0;
  const preset = presetOf(skipped, names);

  function toggleAll() {
    // Most people who turn this off get the common six, so start them there.
    onChange(all ? skippedFor("big6", names) : []);
  }

  function toggle(name: string) {
    onChange(skipped.includes(name) ? skipped.filter((n) => n !== name) : [...skipped, name]);
  }

  return (
    <fieldset className="space-y-3">
      <legend className="text-sm font-medium">Holidays off</legend>
      <button
        type="button"
        role="switch"
        aria-checked={all}
        onClick={toggleAll}
        className="flex w-full items-center justify-between gap-3 rounded-lg border border-app-line bg-app-surface px-3 py-2.5 text-left"
      >
        <span className="text-sm">
          I get all {names.length || "the"} US federal holidays off
        </span>
        <span
          aria-hidden
          className={`relative h-6 w-10 shrink-0 rounded-full transition ${all ? "bg-app-btn" : "bg-app-tile"}`}
        >
          <span className={`absolute top-1 h-4 w-4 rounded-full bg-white transition-all ${all ? "left-5" : "left-1"}`} />
        </span>
      </button>

      {!all && (
        <div className="space-y-3 rounded-lg border border-app-line bg-app-surface p-3">
          {holidays.length === 0 ? (
            <p className="text-sm text-app-muted">Couldn&apos;t load the holiday list. Is the API running?</p>
          ) : (
            <>
              <p className="text-xs text-app-muted">Start from a common setup, then fix any day.</p>
              <div className="flex flex-wrap gap-2">
                {PRESETS.filter((p) => p.id !== "all").map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    aria-pressed={preset === p.id}
                    onClick={() => onChange(skippedFor(p.id, names))}
                    className={`rounded-full px-3 py-1 text-sm font-medium transition ${
                      preset === p.id ? "bg-app-btn text-app-on-btn" : "bg-app-tile text-app-muted"
                    }`}
                  >
                    {p.label}
                  </button>
                ))}
              </div>
              <ul className="space-y-1">
                {holidays.map((h) => (
                  <li key={h.name}>
                    <label className="flex items-center gap-2 text-sm">
                      <input type="checkbox" checked={!skipped.includes(h.name)} onChange={() => toggle(h.name)} />
                      <span className={skipped.includes(h.name) ? "text-app-muted line-through" : ""}>{h.name}</span>
                      <span className="ml-auto tabular-nums text-xs text-app-muted">
                        {shortDate.format(new Date(`${h.date}T00:00:00Z`))}
                      </span>
                    </label>
                  </li>
                ))}
              </ul>
              <p className="text-xs text-app-muted">
                {names.length - skipped.length} of {names.length} · unticked days count as workdays
              </p>
            </>
          )}
        </div>
      )}
    </fieldset>
  );
}
