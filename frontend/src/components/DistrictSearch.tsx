"use client";

import { useEffect, useRef, useState } from "react";

import { api, errorMessage } from "@/lib/api";
import { type District, STATES, calendarStatus, districtPlace, searchable } from "@/lib/districts";

const WAIT_MS = 250; // search after a short pause in typing, not on every key

/**
 * Type-ahead search over every US school district: type a name, city or ZIP and
 * pick from the few closest matches. Replaces a dropdown that would need 13,000 rows.
 */
export default function DistrictSearch({ value, onChange }: { value: District | null; onChange: (d: District | null) => void }) {
  const [query, setQuery] = useState("");
  const [state, setState] = useState("");
  const [results, setResults] = useState<District[]>([]);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const latest = useRef(0); // only the newest search may update the list

  useEffect(() => {
    const q = searchable(query);
    if (!q || value) return;
    const ticket = ++latest.current;
    const timer = setTimeout(() => {
      setSearching(true);
      api
        .GET("/districts", { params: { query: { q, state: state || undefined } } })
        .then(({ data, error }) => {
          if (ticket !== latest.current) return; // a newer search started: drop this answer
          if (!data) throw error;
          setResults(data);
          setError(null);
        })
        .catch((err) => ticket === latest.current && setError(errorMessage(err)))
        .finally(() => ticket === latest.current && setSearching(false));
    }, WAIT_MS);
    return () => clearTimeout(timer);
  }, [query, state, value]);

  if (value) {
    return (
      <div className="mt-1 flex items-start justify-between gap-2 rounded border border-app-line bg-app-surface px-2 py-1.5">
        <div>
          <div className="font-medium">{value.name}</div>
          <div className="text-xs text-app-muted">{districtPlace(value)} · {calendarStatus(value)}</div>
        </div>
        <button type="button" onClick={() => onChange(null)} className="text-xs text-app-link underline">Change</button>
      </div>
    );
  }

  const q = searchable(query);
  return (
    <div className="mt-1 space-y-1">
      <div className="flex gap-2">
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="District name, city or ZIP"
          aria-label="Search school districts"
          autoComplete="off"
          className="block w-full min-w-0 rounded border border-app-line bg-app-surface px-2 py-1"
        />
        <select
          value={state}
          onChange={(e) => setState(e.target.value)}
          aria-label="State"
          className="rounded border border-app-line bg-app-surface px-1 py-1"
        >
          <option value="">Any state</option>
          {STATES.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
      </div>
      {error && <p role="alert" className="text-app-danger">{error}</p>}
      {q && !searching && !error && results.length === 0 && (
        <p className="text-xs text-app-muted">No district matches “{q}”. Try the city, the ZIP, or pick “My school isn&apos;t listed”.</p>
      )}
      {q && results.length > 0 && (
        <ul className="divide-y divide-app-line rounded border border-app-line">
          {results.map((d) => (
            <li key={d.id}>
              <button type="button" onClick={() => onChange(d)} className="block w-full px-2 py-1.5 text-left hover:bg-app-line/30">
                <span className="font-medium">{d.name}</span>
                <span className="block text-xs text-app-muted">{districtPlace(d)} · {calendarStatus(d)}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
