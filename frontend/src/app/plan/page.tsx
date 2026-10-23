"use client";

import { useSession } from "next-auth/react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useMemo, useState } from "react";

import AddAdult from "@/components/AddAdult";
import AddKid from "@/components/AddKid";
import BreakDetail, { BreakSheet } from "@/components/BreakDetail";
import { TabBar, TabNav } from "@/components/PlanTabs";
import BreakList, { type View } from "@/components/BreakList";
import { BestPickCard, FreeCard, FreeSide, StretchCard, TripsCard } from "@/components/HomeCards";
import HomeCalendar from "@/components/HomeCalendar";
import MonthCalendar from "@/components/MonthCalendar";
import PeopleList, { type Opened } from "@/components/PeopleList";
import { ErrorNote } from "@/components/ProfileForm";
import SharePanel from "@/components/SharePanel";
import { textLink } from "@/components/ui";
import { api, errorMessage, type Group, type Me, type PersonSchedule, type Search, type Trip, type Window } from "@/lib/api";
import { addDays, type ISODate, today } from "@/lib/dates";
import { federalSkips, holidaysIn, holidaysYouGet, skipsOn } from "@/lib/holidays";
import { loadHidden, saveHidden } from "@/lib/preferences";
import { describePtoLeft } from "@/lib/profile";
import { isSaved, nextRenewal } from "@/lib/trips";
import { buildDayMarks } from "@/lib/schedule";
import { parseTab, type Tab, TABS, tabQuery } from "@/lib/tabs";

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
  const [allHolidays, setHolidays] = useState(new Map<ISODate, string>()); // every federal holiday
  const [allCompanyDays, setCompanyDays] = useState(new Map<ISODate, string>()); // day after Thanksgiving...
  const [skipped, setSkipped] = useState<{ federal: string[] | null; company: string[] | null }>({
    federal: [], // the federal holidays your job doesn't give
    company: null, // the company days it doesn't (null: none at all)
  });
  const [selected, setSelected] = useState<Window | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [version, setVersion] = useState(0); // bump to re-fetch after a change
  const [trips, setTrips] = useState<Trip[]>([]);
  const [opened, setOpened] = useState<Opened>(null); // whose People sheet is open
  const [schedules, setSchedules] = useState<PersonSchedule[]>([]); // dates of the people you manage
  const [hidden, setHidden] = useState<number[]>(loadHidden); // people whose dates you chose not to draw
  const [tripsVersion, setTripsVersion] = useState(0); // bump after saving: no PTO changed, so no re-rank
  const [sheetOpen, setSheetOpen] = useState(false); // phones: the selected break's detail sheet
  const [view, setView] = useState<View>("best_value"); // Breaks list: best value, longest, or the free ones

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
      const [federal, company] = await Promise.all(
        (["federal", "company"] as const).map(async (kind) =>
          (await Promise.all(years.map((year) => holidaysIn(kind, year)))).flat(),
        ),
      );
      setHolidays(new Map(federal.map((h) => [h.date, h.name])));
      setCompanyDays(new Map(company.map((h) => [h.date, h.name])));
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
  // The plan is drawn from your side, like the work week: a holiday you work is a workday here.
  const holidays = useMemo(
    () => new Map([...holidaysYouGet(allHolidays, skipped.federal), ...holidaysYouGet(allCompanyDays, skipped.company)]),
    [allHolidays, allCompanyDays, skipped],
  );
  const personId = person?.id;
  useEffect(() => {
    if (personId == null) return;
    api
      .GET("/people/{person_id}/calendars", { params: { path: { person_id: personId } } })
      .then(({ data, error }) => {
        if (!data) throw error;
        setSkipped({ federal: federalSkips(data), company: skipsOn(data, "COMPANY") });
      })
      .catch((err) => setError(errorMessage(err)));
  }, [personId, version]);

  // Pick a break. Laptops show it in the side panel already; phones open the sheet.
  // (Only on phones: a modal hidden by CSS would still block the page behind it.)
  function showBreak(w: Window): boolean {
    setSelected(w);
    const phone = window.matchMedia("(max-width: 47.99rem)").matches;
    if (phone) setSheetOpen(true);
    return phone;
  }

  // The Free view lists no-PTO long weekends; the other two re-rank the search.
  function changeView(next: View) {
    setView(next);
    if (next === "free") return setSelected(search?.free_long_weekends[0] ?? null);
    if (next === sort) return setSelected(search?.windows[0] ?? null);
    setSort(next); // the search effect re-selects the top break
  }

  function openTab(next: Tab) {
    router.push(`/plan${tabQuery(params, next)}`);
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
  // When your PTO renews (Jan 1 unless you set a date in Settings): bookings after it use next year's days.
  const renewal = nextRenewal(start, me.people.find((p) => p.id === me.self_person_id)?.pto_renews_on);
  const ptoLine =
    person?.pto_left != null
      ? (person.pto_balance != null
          ? `${person.pto_left} of ${person.pto_balance} PTO days left`
          : describePtoLeft(person.pto_left, person.pto_balance)) +
        // Trips after the renewal don't touch this year's number, so say where they went.
        (person.pto_next_year ? ` · ${person.pto_next_year} booked from next year` : "")
      : null;
  const planTitle = solo && person ? `${person.name}'s best breaks` : group.name;
  // PTO to plan with: yours alone; in a group, the lowest anyone has left, since that
  // person decides whether a trip fits everyone.
  const known = group.people.map((p) => p.pto_left).filter((n): n is number => n != null);
  const ptoBudget = solo ? (person?.pto_left ?? 0) : known.length ? Math.min(...known) : 0;

  // Good breaks you haven't saved yet: tinted on the calendars and the ribbon.
  const picks = search.windows.filter((w) => !isSaved(trips, w.start, w.end));

  // The mockup's legend: small squares, in the same order everywhere.
  const swatch = "inline-block h-2.5 w-2.5 rounded-[3px]";
  const legend = (
    <p className="mt-4 flex flex-wrap gap-x-3 gap-y-2 text-xs text-app-muted">
      <span className="inline-flex items-center gap-1"><i className={`${swatch} bg-app-strong`} />Your PTO</span>
      <span className="inline-flex items-center gap-1"><i className={`${swatch} bg-app-accent`} />Trip</span>
      <span className="inline-flex items-center gap-1"><i className={`${swatch} bg-app-soft`} />Good pick</span>
      <span className="inline-flex items-center gap-1"><i className={`${swatch} rounded-full bg-app-holiday`} />Holiday</span>
      {marks.size > 0 && (
        <>
          <span className="inline-flex items-center gap-1"><i className="inline-block h-1 w-2.5 rounded-sm bg-app-school" />No school</span>
          <span className="inline-flex items-center gap-1"><i className="inline-block h-1 w-2.5 rounded-sm bg-app-busy" />Busy</span>
        </>
      )}
    </p>
  );

  const detailProps = {
    groupId: group.id,
    trips,
    holidays,
    workWeek,
    marks,
    onSaved: () => setTripsVersion((v) => v + 1),
    earliest: start,
    people: group.people,
    schedules,
    onSeeHome: () => {
      setSheetOpen(false);
      openTab("home");
    },
  };

  const tabs = {
    // Home: how far your PTO goes, when everyone's free (groups only), what you've saved,
    // and the single best thing to book next. On a laptop "Everyone's free" becomes a sidebar.
    home: (
      <div
        className={`mx-auto grid max-w-xl gap-6 md:max-w-none md:items-start ${
          solo ? "md:grid-cols-[1fr_1.15fr]" : "md:grid-cols-[1fr_1.15fr_15.5rem]"
        }`}
      >
        <div className="grid content-start gap-6">
          <StretchCard
            windows={search.windows}
            budget={ptoBudget}
            balance={person?.pto_balance ?? null}
            left={person?.pto_left ?? null}
            solo={solo}
            onSee={() => openTab("breaks")}
          />
          {!solo && (
            <div className="md:hidden">
              <FreeCard
                windows={search.windows}
                people={group.people.map((p) => p.name)}
                holidays={holidays}
                marks={marks}
                onPick={(w) => {
                  if (!showBreak(w)) openTab("breaks"); // laptops: its detail panel is on Breaks
                }}
              />
            </div>
          )}
          <TripsCard
            groupId={group.id}
            trips={trips}
            renewal={renewal}
            onPtoChanged={() => setVersion((v) => v + 1)} // booked days change every cost: re-rank
          />
          <BestPickCard
            // The best break you haven't saved yet; saved ones are already in Your trips.
            window={search.windows.find((w) => !isSaved(trips, w.start, w.end))}
            empty={solo ? "No breaks fit your PTO in the next 12 months." : "No break fits everyone in the next 12 months."}
            onPick={(w) => {
              if (!showBreak(w)) openTab("breaks");
            }}
          />
          <button onClick={() => openTab("breaks")} className={`-mt-3 justify-self-start text-sm ${textLink}`}>
            See all breaks →
          </button>
        </div>
        {/* Laptops: the calendar in the middle, everyone's free on the right. */}
        <HomeCalendar
          start={start}
          focus={picks[0]?.start ?? null}
          holidays={holidays}
          workWeek={workWeek}
          saved={trips}
          picks={picks}
          marks={marks}
          legend={legend}
          onOpen={() => openTab("calendar")}
        />
        {!solo && (
          <FreeSide
            windows={search.windows}
            people={group.people.map((p) => p.name)}
            holidays={holidays}
            marks={marks}
            onPick={(w) => {
              setSelected(w);
              openTab("breaks");
            }}
          />
        )}
      </div>
    ),

    // Breaks: the full lists. On a laptop the calendar sits beside them so a pick shows its dates.
    breaks: (
      <div className="mx-auto grid max-w-xl gap-6 md:max-w-none md:grid-cols-[19rem_1fr] md:items-start">
        <section aria-label="Suggestions">
          <BreakList
            view={view}
            onView={changeView}
            windows={search.windows}
            free={search.free_long_weekends}
            selected={selected}
            trips={trips}
            holidays={holidays}
            marks={marks}
            empty={solo ? "No breaks fit your PTO in the next 12 months." : "No break fits everyone in the next 12 months."}
            onSelect={showBreak}
          />
        </section>
        {/* Laptops: the picked break, its days, and who's free. Phones open it as a sheet. */}
        <section aria-label="Break details" className="hidden rounded-2xl border border-app-line bg-app-surface p-5 md:sticky md:top-6 md:block">
          {selected ? (
            <BreakDetail key={`${selected.start}-${selected.end}`} window={selected} {...detailProps} />
          ) : (
            <p className="text-sm text-app-muted">Pick a break to see its days and who&apos;s free.</p>
          )}
        </section>
      </div>
    ),

    // Calendar: the year ribbon, then a month at a time (three on laptops); tap a day for its details.
    calendar: (
      <section aria-label="Calendar" className="mx-auto max-w-xl md:max-w-none">
        <MonthCalendar
          start={start}
          holidays={holidays}
          workWeek={workWeek}
          saved={trips}
          picks={picks}
          marks={marks}
          people={schedules.filter((s) => s.items.length > 0).map((s) => ({
            id: s.person_id,
            name: group.people.find((p) => p.id === s.person_id)?.name ?? "Someone",
            shown: !hidden.includes(s.person_id),
          }))}
          onToggle={toggleDates}
          legend={legend}
        />
      </section>
    ),

    // People: who's in the plan, their schedules, and adding or sharing.
    people: (
      <div className="mx-auto max-w-xl md:max-w-none">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-app-muted">Who&apos;s going</h2>
        <div className="mt-2">
          <PeopleList
            group={group}
            selfId={me.self_person_id}
            schedules={schedules}
            hidden={hidden}
            opened={opened}
            onOpen={setOpened}
            onToggleDates={toggleDates}
            onRemove={remove}
            onChanged={() => setVersion((v) => v + 1)}
          />
        </div>
        <AddKid
          groupId={group.id}
          onAdded={(kidId, enterSchedule) => {
            setVersion((v) => v + 1);
            if (enterSchedule) setOpened({ id: kidId, schedule: true }); // their school isn't listed: type its dates in next
          }}
        />
        <AddAdult groupId={group.id} onAdded={() => setVersion((v) => v + 1)} />
        {solo && (
          <p className="mt-2 text-xs text-app-muted">
            Tap a name for their schedule: school breaks, games, or dates you can&apos;t take off.
          </p>
        )}
        {group.role === "OWNER" && <SharePanel groupId={group.id} />}
      </div>
    ),
  };

  return (
    // Bottom padding on phones keeps the last item clear of the tab bar.
    <div className="pb-28 md:pb-10">
      {/* Laptops: a full-width band, plan name left, tabs centered, PTO left and the gear right. */}
      <header className="md:border-b md:border-app-line md:bg-app-surface">
        <div className="mx-auto grid w-full max-w-6xl grid-cols-[1fr_auto] items-center gap-4 px-4 pt-8 md:grid-cols-[1fr_auto_1fr] md:py-3 md:pt-3">
          <div>
            {/* Phones name the tab you're on (the tab bar is at the bottom); laptops keep the plan's name. */}
            <h1 className="font-display text-2xl font-bold tracking-tight md:text-xl">
              <span className="md:hidden">{tab === "home" ? planTitle : TABS.find((t) => t.id === tab)?.label}</span>
              <span className="hidden md:inline">{planTitle}</span>
            </h1>
            {ptoLine && <p className="mt-0.5 text-sm text-app-muted md:hidden">{ptoLine}</p>}
          </div>
          <div className="hidden md:block"><TabNav current={tab} onChange={openTab} /></div>
          <div className="flex items-center justify-end gap-3 text-sm">
            {ptoLine && <span className="hidden text-app-muted md:inline">{ptoLine}</span>}
            {me.groups.length > 1 && (
              <select
                aria-label="Plan"
                value={group.id}
                onChange={(e) => router.push(`/plan?group=${e.target.value}`)}
                className="max-w-36 rounded-lg border border-app-line bg-app-surface px-2 py-1"
              >
                {me.groups.map((g) => (
                  <option key={g.id} value={g.id}>{g.name}</option>
                ))}
              </select>
            )}
            {/* Settings (and Sign out, inside it) behind one gear, like the mockup. */}
            <Link href="/settings" aria-label="Settings" className="grid h-10 w-10 place-items-center rounded-full text-app-muted hover:bg-app-surface hover:text-foreground">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="h-6 w-6">
                <circle cx="12" cy="12" r="3" />
                <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" />
              </svg>
            </Link>
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-6xl px-4 pt-8">
        {tabs[tab]}
      </main>

      <TabBar current={tab} onChange={openTab} />
      {selected && (
        <BreakSheet window={selected} open={sheetOpen} onClose={() => setSheetOpen(false)} {...detailProps} />
      )}
    </div>
  );
}
