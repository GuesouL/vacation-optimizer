"use client";

import { useParams } from "next/navigation";
import { useEffect, useState } from "react";

import { ErrorNote } from "@/components/ProfileForm";
import WindowList from "@/components/WindowList";
import { api, errorMessage, type Window } from "@/lib/api";
import { describeCost } from "@/lib/costs";
import { addDays, today } from "@/lib/dates";

type SharedView = { group_name: string; people: string[]; search: { windows: Window[]; free_long_weekends: Window[] } };

/** Read-only plan for a view link. No sign-in, first names and dates only. */
export default function ViewPage() {
  const { token } = useParams<{ token: string }>();
  const [view, setView] = useState<SharedView | null>(null);
  const [selected, setSelected] = useState<Window | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const start = today();
    api
      .GET("/links/{token}/view", {
        params: { path: { token }, query: { start, end: addDays(start, 364), limit: 10 } },
      })
      .then(({ data, error }) => {
        if (!data) throw error;
        setView(data);
      })
      .catch((err) => setError(errorMessage(err)));
  }, [token]);

  if (error) return <main className="mx-auto max-w-md px-4 py-12"><ErrorNote>{error}</ErrorNote></main>;
  if (!view) return <main className="mx-auto max-w-md px-4 py-12 text-zinc-500">Loading the plan…</main>;

  return (
    <main className="mx-auto w-full max-w-md px-4 py-12">
      <p className="text-sm font-medium text-zinc-500">Shared plan · read-only</p>
      <h1 className="mt-1 text-3xl font-semibold tracking-tight">{view.group_name}</h1>
      <p className="mt-2 text-zinc-600 dark:text-zinc-400">With {view.people.join(", ")}</p>
      <WindowList
        title="Best breaks for everyone"
        empty="No break fits everyone in the next 12 months."
        windows={view.search.windows}
        selected={selected}
        onSelect={setSelected}
        describe={describeCost}
        badge={(w) => (w.score ? `${w.score.toFixed(1)}×` : null)}
      />
      <WindowList
        title="Free long weekends"
        empty="None in this range."
        windows={view.search.free_long_weekends}
        selected={selected}
        onSelect={setSelected}
        describe={describeCost}
        badge={() => null}
      />
    </main>
  );
}
