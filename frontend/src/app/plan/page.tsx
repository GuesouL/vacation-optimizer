"use client";

import { signOut, useSession } from "next-auth/react";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useMemo, useState } from "react";

import { ErrorNote } from "@/components/ProfileForm";
import SharePanel from "@/components/SharePanel";
import WindowList from "@/components/WindowList";
import YearCalendar from "@/components/YearCalendar";
import { api, apiToken, errorMessage, type Group, type Me, type Search, type Window } from "@/lib/api";
import { describeCost } from "@/lib/costs";
import { addDays, type ISODate, today } from "@/lib/dates";

type Sort = "best_value" | "longest";

// useSearchParams needs a Suspense boundary so Next can still prerender the page shell.
export default function PlanPage() {
  return (
    <Suspense fallback={<Loading />}>
      <Plan />
    </Suspense>
  );
}

function Loading() {
  return <main className="mx-auto max-w-md px-4 py-12 text-zinc-500">Finding your best breaks…</main>;
}

function Plan() {
  const router = useRouter();
  const params = useSearchParams();
  const { status } = useSession();
  const [me, setMe] = useState<Me | null>(null);
  const [start] = useState<ISODate>(() => today());
  const end = addDays(start, 364);
  const [sort, setSort] = useState<Sort>("best_value");
  const [group, setGroup] = useState<Group | null>(null);
  const [search, setSearch] = useState<Search | null>(null);
  const [holidays, setHolidays] = useState(new Map<ISODate, string>());
  const [selected, setSelected] = useState<Window | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [version, setVersion] = useState(0); // bump to re-fetch after a change

  // ?group=12 picks a group; otherwise your first one.
  const groupId = Number(params.get("group")) || me?.groups[0]?.id;

  // Who you are, and the holidays, once you're signed in.
  useEffect(() => {
    if (status === "unauthenticated") router.replace("/");
    if (status !== "authenticated") return;
    (async () => {
      const found = await api.GET("/me");
      if (!found.data) throw found.error;
      if (!found.data.groups.length) {
        router.replace("/"); // no plan yet: back to onboarding
        return;
      }
      setMe(found.data);

      const years = [...new Set([start.slice(0, 4), end.slice(0, 4)])].map(Number);
      const lists = await Promise.all(
        years.map((year) => api.GET("/holidays/{year}", { params: { path: { year } } })),
      );
      setHolidays(new Map(lists.flatMap((l) => l.data ?? []).map((h) => [h.date, h.name])));
    })().catch((err) => setError(errorMessage(err)));
  }, [status, router, start, end, version]);

  useEffect(() => {
    if (groupId == null) return;
    api
      .GET("/groups/{group_id}", { params: { path: { group_id: groupId } } })
      .then(({ data, error }) => {
        if (!data) throw error;
        setGroup(data);
      })
      .catch((err) => setError(errorMessage(err)));
  }, [groupId, version]);

  // Re-rank whenever the group or the sort order changes.
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

  const person = group?.people.find((p) => p.id === me?.self_person_id) ?? group?.people.find((p) => p.mine);
  const workWeek = useMemo(() => person?.work_week ?? [0, 1, 2, 3, 4], [person]);

  function signOutNow() {
    apiToken.clear();
    signOut({ redirectTo: "/" });
  }

  async function remove(personId: number) {
    if (!group) return;
    const { error } = await api.DELETE("/groups/{group_id}/members/{person_id}", {
      params: { path: { group_id: group.id, person_id: personId } },
    });
    if (error) return setError(errorMessage(error));
    const leftGroup = group.role !== "OWNER" && group.people.filter((p) => p.mine).length === 1;
    // Took your last person out: the group isn't yours to see any more, so go to your next one.
    if (leftGroup) {
      setGroup(null);
      router.replace("/plan");
    }
    setVersion((v) => v + 1);
  }

  if (error) return <main className="mx-auto max-w-md px-4 py-12"><ErrorNote>{error}</ErrorNote></main>;
  if (!me || !group || !search) return <Loading />;

  const solo = group.people.length === 1;

  return (
    <main className="mx-auto w-full max-w-6xl px-4 py-10">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">
            {solo && person ? `${person.name}'s best breaks` : group.name}
          </h1>
          <p className="mt-1 text-zinc-600 dark:text-zinc-400">
            {person?.pto_balance != null && `You have ${person.pto_balance} PTO days · `}next 12 months
          </p>
        </div>
        <div className="flex items-center gap-4 text-sm">
          {me.groups.length > 1 && (
            <label className="flex items-center gap-2">
              <span className="text-zinc-500">Plan</span>
              <select
                value={group.id}
                onChange={(e) => router.push(`/plan?group=${e.target.value}`)}
                className="rounded-lg border border-zinc-300 bg-white px-2 py-1 dark:border-zinc-700 dark:bg-zinc-900"
              >
                {me.groups.map((g) => (
                  <option key={g.id} value={g.id}>{g.name}</option>
                ))}
              </select>
            </label>
          )}
          <button onClick={signOutNow} className="text-zinc-500 underline hover:text-zinc-800 dark:hover:text-zinc-200">
            Sign out
          </button>
        </div>
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
            empty={solo ? "No breaks fit your PTO in the next 12 months." : "No break fits everyone in the next 12 months."}
            windows={search.windows}
            selected={selected}
            onSelect={setSelected}
            describe={describeCost}
            badge={(w) => (sort === "best_value" && w.score ? `${w.score.toFixed(1)}×` : null)}
          />

          <WindowList
            title="Free long weekends"
            empty="None in this range."
            windows={search.free_long_weekends}
            selected={selected}
            onSelect={setSelected}
            describe={describeCost}
            badge={() => null}
          />

          <div className="mt-8">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-500">Who&apos;s going</h2>
            <ul className="mt-2 space-y-1 text-sm">
              {group.people.map((p) => (
                <li key={p.id} className="flex items-center justify-between gap-2">
                  <span>
                    {p.name}
                    {p.mine && (
                      <span className="ml-2 text-xs text-zinc-500">{p.id === me.self_person_id ? "you" : "yours"}</span>
                    )}
                  </span>
                  {(group.role === "OWNER" ? p.id !== me.self_person_id : p.mine) && (
                    <button onClick={() => remove(p.id)} className="text-xs text-zinc-500 underline">
                      {p.mine ? "Take out" : "Remove"}
                    </button>
                  )}
                </li>
              ))}
            </ul>
            {group.role === "OWNER" && <SharePanel groupId={group.id} />}
          </div>
        </section>

        <section aria-label="Year calendar">
          <YearCalendar start={start} holidays={holidays} workWeek={workWeek} selected={selected} />
          <p className="mt-4 flex flex-wrap gap-4 text-xs text-zinc-500">
            <span><span className="mr-1 inline-block h-2 w-2 rounded-full bg-amber-500" />Holiday</span>
            <span><span className="mr-1 inline-block h-3 w-3 rounded bg-teal-600 align-middle" />Selected trip</span>
            <span><span className="mr-1 inline-block h-3 w-3 rounded bg-teal-800 align-middle" />Your PTO day</span>
          </p>
        </section>
      </div>
    </main>
  );
}
