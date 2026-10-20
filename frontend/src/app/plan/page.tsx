"use client";

import { signOut, useSession } from "next-auth/react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useMemo, useState } from "react";

import AddAdult from "@/components/AddAdult";
import AddKid from "@/components/AddKid";
import { TabBar, TabNav } from "@/components/PlanTabs";
import { ErrorNote } from "@/components/ProfileForm";
import SavedTrips from "@/components/SavedTrips";
import ScheduleEditor from "@/components/ScheduleEditor";
import SharePanel from "@/components/SharePanel";
import WindowList from "@/components/WindowList";
import YearCalendar from "@/components/YearCalendar";
import { api, apiToken, errorMessage, type Group, type Me, type PersonSchedule, type Search, type Trip, type Window } from "@/lib/api";
import { describeCost } from "@/lib/costs";
import { addDays, type ISODate, today } from "@/lib/dates";
import { loadHidden, saveHidden } from "@/lib/preferences";
import { describePtoLeft } from "@/lib/profile";
import { buildDayMarks } from "@/lib/schedule";
import { parseTab, type Tab, tabQuery } from "@/lib/tabs";

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
  return <main className="mx-auto max-w-md px-4 py-12 text-app-muted">Finding your best breaks…</main>;
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
  const [trips, setTrips] = useState<Trip[]>([]);
  const [editing, setEditing] = useState<number | null>(null); // whose schedule is open
  const [schedules, setSchedules] = useState<PersonSchedule[]>([]); // dates of the people you manage
  const [hidden, setHidden] = useState<number[]>(loadHidden); // people whose dates you chose not to draw
  const [tripsVersion, setTripsVersion] = useState(0); // bump after saving: no PTO changed, so no re-rank

  // ?group=12 picks a group; otherwise your first one.
  const groupId = Number(params.get("group")) || me?.groups[0]?.id;
  // ?tab=calendar picks a tab. It lives in the URL so the back button and shared links keep it.
  const tab = parseTab(params.get("tab"));

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

  // Saved trips. They're re-read when the group reloads (after a booking) or one is saved.
  useEffect(() => {
    if (!group) return;
    api
      .GET("/groups/{group_id}/trips", { params: { path: { group_id: group.id } } })
      .then(({ data, error }) => {
        if (!data) throw error;
        setTrips(data);
      })
      .catch((err) => setError(errorMessage(err)));
  }, [group, tripsVersion]);

  // School breaks and busy days for your own people. Re-read whenever the group reloads.
  useEffect(() => {
    if (!group) return;
    api
      .GET("/groups/{group_id}/schedule", { params: { path: { group_id: group.id }, query: { start, end } } })
      .then(({ data, error }) => {
        if (!data) throw error;
        setSchedules(data);
      })
      .catch((err) => setError(errorMessage(err)));
  }, [group, start, end]);

  const marks = useMemo(
    () => buildDayMarks(schedules.filter((s) => !hidden.includes(s.person_id)), start, end),
    [schedules, hidden, start, end],
  );

  function toggleDates(personId: number, show: boolean) {
    const next = show ? hidden.filter((id) => id !== personId) : [...hidden, personId];
    setHidden(next);
    saveHidden(next);
  }

  const person = group?.people.find((p) => p.id === me?.self_person_id) ?? group?.people.find((p) => p.mine);
  const workWeek = useMemo(() => person?.work_week ?? [0, 1, 2, 3, 4], [person]);

  function openTab(next: Tab) {
    router.push(`/plan${tabQuery(params, next)}`);
  }

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

  const sortToggle = (
    <div role="group" aria-label="Sort" className="inline-flex rounded-lg bg-app-tile p-1 text-sm">
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
            sort === value ? "bg-app-surface shadow-sm" : "text-app-muted"
          }`}
        >
          {label}
        </button>
      ))}
    </div>
  );

  // Up top in a tab, so the Save button sits next to the suggestion you just picked.
  const savedTrips = (
    <SavedTrips
      groupId={group.id}
      trips={trips}
      selected={selected}
      onSaved={() => setTripsVersion((v) => v + 1)}
      onPtoChanged={() => setVersion((v) => v + 1)} // booked days change every cost: re-rank
    />
  );

  const calendar = (
    <>
      <YearCalendar start={start} holidays={holidays} workWeek={workWeek} selected={selected} saved={trips} marks={marks} />
      <p className="mt-4 flex flex-wrap gap-4 text-xs text-app-muted">
        <span><span className="mr-1 inline-block h-2 w-2 rounded-full bg-app-holiday" />Holiday</span>
        <span><span className="mr-1 inline-block h-3 w-3 rounded bg-app-accent align-middle" />Selected trip</span>
        <span><span className="mr-1 inline-block h-3 w-3 rounded bg-app-strong align-middle" />Your PTO day</span>
        <span><span className="mr-1 inline-block h-3 w-3 rounded bg-app-soft ring-1 ring-inset ring-app-line align-middle" />Saved trip</span>
        {marks.size > 0 && (
          <>
            <span><span className="mr-1 inline-block h-[3px] w-3 rounded-full bg-app-school align-middle" />School break or day off</span>
            <span><span className="mr-1 inline-block h-1 w-3 rounded-full bg-app-busy align-middle" />Busy</span>
          </>
        )}
      </p>
    </>
  );

  const ranked = (
    <WindowList
      title="Ranked suggestions"
      empty={solo ? "No breaks fit your PTO in the next 12 months." : "No break fits everyone in the next 12 months."}
      windows={search.windows}
      selected={selected}
      onSelect={setSelected}
      describe={describeCost}
      badge={(w) => (sort === "best_value" && w.score ? `${w.score.toFixed(1)}×` : null)}
    />
  );

  const tabs = {
    // Home: what you've saved, and the single best thing to book next.
    home: (
      <div className="mx-auto max-w-xl">
        {savedTrips}
        <WindowList
          title="Best next pick"
          empty={solo ? "No breaks fit your PTO in the next 12 months." : "No break fits everyone in the next 12 months."}
          windows={search.windows.slice(0, 1)}
          selected={selected}
          onSelect={setSelected}
          describe={describeCost}
          badge={() => null}
        />
        <button onClick={() => openTab("breaks")} className="mt-4 text-sm font-medium text-app-link underline">
          See all breaks →
        </button>
      </div>
    ),

    // Breaks: the full lists. On a laptop the calendar sits beside them so a pick shows its dates.
    breaks: (
      <div className="grid gap-10 md:grid-cols-[22rem_1fr]">
        <section aria-label="Suggestions">
          {sortToggle}
          {savedTrips}
          {ranked}
          <WindowList
            title="Free long weekends"
            empty="None in this range."
            windows={search.free_long_weekends}
            selected={selected}
            onSelect={setSelected}
            describe={describeCost}
            badge={() => null}
          />
        </section>
        <section aria-label="Year calendar" className="hidden md:block">{calendar}</section>
      </div>
    ),

    calendar: <section aria-label="Year calendar">{calendar}</section>,

    // People: who's in the plan, their schedules, and adding or sharing.
    people: (
      <div className="mx-auto max-w-xl">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-app-muted">Who&apos;s going</h2>
        <ul className="mt-2 space-y-1 text-sm">
          {group.people.map((p) => (
            <li key={p.id}>
              <div className="flex items-center justify-between gap-2">
                <span>
                  {p.name}
                  {p.mine && (
                    <span className="ml-2 text-xs text-app-muted">{p.id === me.self_person_id ? "you" : "yours"}</span>
                  )}
                </span>
                <span className="flex items-center gap-3">
                  {schedules.find((s) => s.person_id === p.id)?.items.length ? (
                    <label className="flex items-center gap-1 text-xs text-app-muted">
                      <input
                        type="checkbox"
                        checked={!hidden.includes(p.id)}
                        onChange={(e) => toggleDates(p.id, e.target.checked)}
                        aria-label={`Show ${p.name}'s dates on the calendar`}
                      />
                      Show
                    </label>
                  ) : null}
                  {p.mine && p.kind === "ADULT" && (
                    <Link href={`/settings?person=${p.id}`} className="text-xs text-app-link underline">
                      Edit
                    </Link>
                  )}
                  {p.mine && (
                    <button onClick={() => setEditing(editing === p.id ? null : p.id)} className="text-xs text-app-link underline">
                      Schedule
                    </button>
                  )}
                  {(group.role === "OWNER" ? p.id !== me.self_person_id : p.mine) && (
                    <button onClick={() => remove(p.id)} className="text-xs text-app-muted underline">
                      {p.mine ? "Take out" : "Remove"}
                    </button>
                  )}
                </span>
              </div>
              {editing === p.id && (
                <ScheduleEditor
                  person={p}
                  onChanged={() => setVersion((v) => v + 1)} // new dates change every suggestion: re-rank
                  onClose={() => setEditing(null)}
                />
              )}
            </li>
          ))}
        </ul>
        <AddKid
          groupId={group.id}
          onAdded={(kidId, enterSchedule) => {
            setVersion((v) => v + 1);
            if (enterSchedule) setEditing(kidId); // their school isn't listed: type its dates in next
          }}
        />
        <AddAdult groupId={group.id} onAdded={() => setVersion((v) => v + 1)} />
        {solo && (
          <p className="mt-2 text-xs text-app-muted">
            Use Schedule next to a name for school breaks, games, or dates you can&apos;t take off.
          </p>
        )}
        {group.role === "OWNER" && <SharePanel groupId={group.id} />}
      </div>
    ),
  };

  return (
    // Bottom padding on phones keeps the last item clear of the tab bar.
    <main className="mx-auto w-full max-w-6xl px-4 pb-28 pt-8 md:pb-10 md:pt-10">
      <header className="grid items-center gap-4 md:grid-cols-[1fr_auto_1fr]">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight md:text-3xl">
            {solo && person ? `${person.name}'s best breaks` : group.name}
          </h1>
          <p className="mt-1 text-sm text-app-muted md:text-base">
            {person?.pto_left != null && `You have ${describePtoLeft(person.pto_left, person.pto_balance)} · `}next 12 months
          </p>
        </div>
        <TabNav current={tab} onChange={openTab} />
        <div className="flex flex-wrap items-center gap-4 text-sm md:justify-end">
          {me.groups.length > 1 && (
            <label className="flex items-center gap-2">
              <span className="text-app-muted">Plan</span>
              <select
                value={group.id}
                onChange={(e) => router.push(`/plan?group=${e.target.value}`)}
                className="rounded-lg border border-app-line bg-app-surface px-2 py-1"
              >
                {me.groups.map((g) => (
                  <option key={g.id} value={g.id}>{g.name}</option>
                ))}
              </select>
            </label>
          )}
          <Link href="/settings" className="text-app-muted underline hover:text-foreground">
            Settings
          </Link>
          <button onClick={signOutNow} className="text-app-muted underline hover:text-foreground">
            Sign out
          </button>
        </div>
      </header>

      <div className="mt-8">{tabs[tab]}</div>

      <TabBar current={tab} onChange={openTab} />
    </main>
  );
}
