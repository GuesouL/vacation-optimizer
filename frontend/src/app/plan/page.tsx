"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

import YearCalendar from "@/components/YearCalendar";
import { api, errorMessage, type Group, type Search, type Window } from "@/lib/api";
import { addDays, formatRange, type ISODate, today } from "@/lib/dates";
import { clearPlan, loadPlan } from "@/lib/storage";

type Sort = "best_value" | "longest";

export default function PlanPage() {
  const router = useRouter();
  const [start] = useState<ISODate>(() => today());
  const end = addDays(start, 364);
  const [sort, setSort] = useState<Sort>("best_value");
  const [group, setGroup] = useState<Group | null>(null);
  const [search, setSearch] = useState<Search | null>(null);
  const [holidays, setHolidays] = useState(new Map<ISODate, string>());
  const [selected, setSelected] = useState<Window | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Load the person and the holidays once.
  useEffect(() => {
    const plan = loadPlan();
    if (!plan) {
      router.replace("/");
      return;
    }
    (async () => {
      const found = await api.GET("/groups/{group_id}", {
        params: { path: { group_id: plan.groupId } },
      });
      if (!found.data) {
        // The saved plan points at a group the database no longer has.
        clearPlan();
        router.replace("/");
        return;
      }
      setGroup(found.data);

      const years = [...new Set([start.slice(0, 4), end.slice(0, 4)])].map(Number);
      const lists = await Promise.all(
        years.map((year) => api.GET("/holidays/{year}", { params: { path: { year } } })),
      );
      setHolidays(new Map(lists.flatMap((l) => l.data ?? []).map((h) => [h.date, h.name])));
    })().catch((err) => setError(errorMessage(err)));
  }, [router, start, end]);

  // Re-rank whenever the sort order changes.
  useEffect(() => {
    if (!group) return;
    api
      .GET("/groups/{group_id}/windows", {
        params: { path: { group_id: group.id }, query: { start, end, sort, limit: 10 } },
      })
      .then(({ data, error }) => {
        if (!data) throw error;
        setSearch(data);
        setSelected(data.windows[0] ?? data.free_long_weekends[0] ?? null);
      })
      .catch((err) => setError(errorMessage(err)));
  }, [group, start, end, sort]);

  const person = group?.people[0];
  const workWeek = useMemo(() => person?.work_week ?? [0, 1, 2, 3, 4], [person]);

  function startOver() {
    clearPlan();
    router.push("/");
  }

  if (error) {
    return (
      <main className="mx-auto max-w-md px-4 py-12">
        <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-red-800 dark:bg-red-950 dark:text-red-200">
          {error}
        </p>
      </main>
    );
  }

  if (!person || !search) {
    return <main className="mx-auto max-w-md px-4 py-12 text-zinc-500">Finding your best breaks…</main>;
  }

  return (
    <main className="mx-auto w-full max-w-6xl px-4 py-10">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">{person.name}&apos;s best breaks</h1>
          <p className="mt-1 text-zinc-600 dark:text-zinc-400">
            {person.pto_balance} PTO days · next 12 months
          </p>
        </div>
        <button onClick={startOver} className="text-sm text-zinc-500 underline hover:text-zinc-800 dark:hover:text-zinc-200">
          Start over
        </button>
      </header>

      <div className="mt-8 grid gap-10 lg:grid-cols-[22rem_1fr]">
        <section aria-label="Suggestions">
          <div role="group" aria-label="Sort" className="inline-flex rounded-lg bg-zinc-100 p-1 text-sm dark:bg-zinc-800">
            {(
              [
                ["best_value", "Best value"],
                ["longest", "Longest trip"],
              ] as const
            ).map(([value, label]) => (
              <button
                key={value}
                aria-pressed={sort === value}
                onClick={() => setSort(value)}
                className={`rounded-md px-3 py-1.5 font-medium ${
                  sort === value ? "bg-white shadow-sm dark:bg-zinc-950" : "text-zinc-500"
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          <WindowList
            title="Ranked suggestions"
            empty="No breaks fit your PTO in the next 12 months."
            windows={search.windows}
            selected={selected}
            onSelect={setSelected}
            describe={(w) => {
              const cost = w.pto_cost[person.name];
              return `${w.days} days off for ${cost} PTO day${cost === 1 ? "" : "s"}`;
            }}
            badge={(w) => (sort === "best_value" && w.score ? `${w.score.toFixed(1)}×` : null)}
          />

          <WindowList
            title="Free long weekends"
            empty="None in this range."
            windows={search.free_long_weekends}
            selected={selected}
            onSelect={setSelected}
            describe={(w) => `${w.days} days off, no PTO needed`}
            badge={() => null}
          />
        </section>

        <section aria-label="Year calendar">
          <YearCalendar start={start} holidays={holidays} workWeek={workWeek} selected={selected} />
          <p className="mt-4 flex flex-wrap gap-4 text-xs text-zinc-500">
            <span><span className="mr-1 inline-block h-2 w-2 rounded-full bg-amber-500" />Holiday</span>
            <span><span className="mr-1 inline-block h-3 w-3 rounded bg-teal-600 align-middle" />Selected trip</span>
            <span><span className="mr-1 inline-block h-3 w-3 rounded bg-teal-800 align-middle" />PTO day</span>
          </p>
        </section>
      </div>
    </main>
  );
}

function WindowList(props: {
  title: string;
  empty: string;
  windows: Window[];
  selected: Window | null;
  onSelect: (w: Window) => void;
  describe: (w: Window) => string;
  badge: (w: Window) => string | null;
}) {
  return (
    <div className="mt-6">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-500">{props.title}</h2>
      {props.windows.length === 0 ? (
        <p className="mt-2 text-sm text-zinc-500">{props.empty}</p>
      ) : (
        <ol className="mt-2 space-y-2">
          {props.windows.map((w) => {
            const active = props.selected?.start === w.start && props.selected?.end === w.end;
            const badge = props.badge(w);
            return (
              <li key={`${w.start}-${w.end}`}>
                <button
                  onClick={() => props.onSelect(w)}
                  aria-pressed={active}
                  className={`w-full rounded-xl border px-4 py-3 text-left transition ${
                    active
                      ? "border-teal-600 bg-teal-50 dark:bg-teal-950"
                      : "border-zinc-200 hover:border-zinc-400 dark:border-zinc-800"
                  }`}
                >
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="font-medium">{formatRange(w.start, w.end)}</span>
                    {badge && <span className="text-sm font-semibold text-teal-700 dark:text-teal-400">{badge}</span>}
                  </div>
                  <div className="text-sm text-zinc-500">{props.describe(w)}</div>
                </button>
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}
