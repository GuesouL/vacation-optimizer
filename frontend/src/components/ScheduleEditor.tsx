"use client";

import { type FormEvent, useEffect, useState } from "react";

import IcsImport from "@/components/IcsImport";
import { api, type CalendarEvent, type CalendarInfo, errorMessage } from "@/lib/api";
import { formatRange, type ISODate } from "@/lib/dates";
import { type CalendarKind, effectLabel, kindsFor, rangeProblem, summerBreak } from "@/lib/schedule";

type Person = { id: number; name: string; kind: "ADULT" | "CHILD" | "GUEST" };
type Mine = CalendarInfo & { kind: CalendarKind }; // your own calendars are never the computed federal one

const input =
  "mt-1 block w-full rounded border border-zinc-300 bg-white px-2 py-1 dark:border-zinc-700 dark:bg-zinc-900";
const PRESETS = ["Winter break", "Spring break", "Thanksgiving recess", "Mid-winter recess"];

/**
 * One person's own schedules: a kid's school breaks, a team's tournaments, an adult's
 * blackout dates. Type dates in or import a file; both end up as the same saved events.
 */
export default function ScheduleEditor(props: { person: Person; onChanged: () => void; onClose: () => void }) {
  const { person } = props;
  const kinds = kindsFor(person.kind);
  const [calendars, setCalendars] = useState<CalendarInfo[] | null>(null);
  const [calendarId, setCalendarId] = useState<number | null>(null);
  // Remember which calendar the events belong to, so switching never shows the old one's dates.
  const [loaded, setLoaded] = useState<{ id: number; events: CalendarEvent[] } | null>(null);
  const [version, setVersion] = useState(0); // bump to re-read after a change
  const [error, setError] = useState<string | null>(null);

  const mine = (calendars ?? []).filter((c): c is Mine => c.mine && c.kind !== "FEDERAL");
  const shared = (calendars ?? []).filter((c) => !c.mine && c.kind !== "FEDERAL");
  const current = mine.find((c) => c.id === calendarId) ?? null;
  const events = loaded?.id === calendarId ? loaded.events : [];

  useEffect(() => {
    api
      .GET("/people/{person_id}/calendars", { params: { path: { person_id: person.id } } })
      .then(({ data, error }) => {
        if (!data) throw error;
        setCalendars(data);
        setCalendarId((id) => (data.some((c) => c.mine && c.id === id) ? id : (data.find((c) => c.mine)?.id ?? null)));
      })
      .catch((err) => setError(errorMessage(err)));
  }, [person.id, version]);

  useEffect(() => {
    if (calendarId == null) return;
    api
      .GET("/calendars/{calendar_id}/events", { params: { path: { calendar_id: calendarId } } })
      .then(({ data, error }) => {
        if (!data) throw error;
        setLoaded({ id: calendarId, events: data });
      })
      .catch((err) => setError(errorMessage(err)));
  }, [calendarId, version]);

  // A change to dates changes every suggestion, so the plan re-ranks too.
  function changed() {
    setVersion((v) => v + 1);
    props.onChanged();
  }

  async function attempt(request: () => Promise<{ error?: unknown }>, done: () => void) {
    setError(null);
    const { error } = await request();
    if (error) return setError(errorMessage(error));
    done();
  }

  const addEvents = (drafts: { title: string; start_date: ISODate; end_date: ISODate; effect: "DAY_OFF" | "BUSY" }[]) =>
    attempt(
      () => api.POST("/calendars/{calendar_id}/events/bulk", {
        params: { path: { calendar_id: calendarId! } },
        body: { events: drafts },
      }),
      changed,
    );

  const removeEvent = (id: number) =>
    attempt(
      () => api.DELETE("/calendars/{calendar_id}/events/{event_id}", { params: { path: { calendar_id: calendarId!, event_id: id } } }),
      changed,
    );

  function removeCalendar() {
    if (!current || !window.confirm(`Delete "${current.name}" and all its dates?`)) return;
    attempt(() => api.DELETE("/calendars/{calendar_id}", { params: { path: { calendar_id: current.id } } }), () => {
      setCalendarId(null);
      changed();
    });
  }

  async function createCalendar(name: string, kind: CalendarKind) {
    setError(null);
    const made = await api.POST("/calendars", { body: { name, kind } });
    if (!made.data) return setError(errorMessage(made.error));
    const link = await api.POST("/people/{person_id}/calendars", {
      params: { path: { person_id: person.id } },
      body: { calendar_id: made.data.id },
    });
    if (link.error) return setError(errorMessage(link.error));
    setCalendarId(made.data.id);
    setVersion((v) => v + 1);
  }

  return (
    <div className="mt-3 rounded-lg border border-zinc-200 p-3 text-sm dark:border-zinc-800">
      <div className="flex items-baseline justify-between gap-2">
        <h3 className="font-semibold">{person.name}&apos;s schedule</h3>
        <button onClick={props.onClose} className="text-xs text-zinc-500 underline">Close</button>
      </div>
      {error && <p role="alert" className="mt-2 text-red-700">{error}</p>}
      {calendars === null ? (
        <p className="mt-2 text-zinc-500">Loading…</p>
      ) : (
        <>
          {shared.length > 0 && (
            <p className="mt-2 text-xs text-zinc-500">Also using (shared): {shared.map((c) => c.name).join(", ")}</p>
          )}
          {mine.length > 1 && (
            <label className="mt-2 block">
              <span className="font-medium">Calendar</span>
              <select value={calendarId ?? ""} onChange={(e) => setCalendarId(Number(e.target.value))} className={input}>
                {mine.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            </label>
          )}
          {current ? (
            <>
              <EventList events={events} kind={current.kind} onDelete={removeEvent} />
              <AddEvent kind={current.kind} onAdd={(draft) => addEvents([draft])} />
              {current.kind === "SCHOOL" && <SummerHelper onAdd={(draft) => addEvents([draft])} />}
              <IcsImport calendarId={current.id} kind={current.kind} onSaved={changed} />
              <button onClick={removeCalendar} className="mt-3 text-xs text-zinc-500 underline">Delete this calendar</button>
            </>
          ) : (
            <p className="mt-2 text-zinc-600 dark:text-zinc-400">
              {person.kind === "CHILD"
                ? `Add ${person.name}'s school breaks, or their games and activities.`
                : "Add dates you can't take off, like work blackouts, games or obligations."}
            </p>
          )}
          <NewCalendar person={person} kinds={kinds} first={!current} onCreate={createCalendar} />
        </>
      )}
    </div>
  );
}

function EventList(props: { events: CalendarEvent[]; kind: CalendarKind; onDelete: (id: number) => void }) {
  if (!props.events.length) return <p className="mt-3 text-zinc-500">No dates yet.</p>;
  return (
    <ul className="mt-3 max-h-56 space-y-1 overflow-y-auto">
      {props.events.map((e) => (
        <li key={e.id} className="flex items-baseline justify-between gap-2">
          <span className="min-w-0">
            <span className="font-medium">{e.title}</span>{" "}
            <span className="text-xs text-zinc-500">
              {formatRange(e.start_date, e.end_date)} · {effectLabel(e.effect, props.kind)}
            </span>
          </span>
          <button onClick={() => props.onDelete(e.id)} aria-label={`Delete ${e.title}`} className="text-xs text-zinc-500 underline">
            Delete
          </button>
        </li>
      ))}
    </ul>
  );
}

function AddEvent(props: {
  kind: CalendarKind;
  onAdd: (draft: { title: string; start_date: ISODate; end_date: ISODate; effect: "DAY_OFF" | "BUSY" }) => Promise<void>;
}) {
  const [title, setTitle] = useState("");
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [effect, setEffect] = useState<"DAY_OFF" | "BUSY">(props.kind === "SCHOOL" ? "DAY_OFF" : "BUSY");
  const [problem, setProblem] = useState<string | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    const found = rangeProblem(title, start, end);
    setProblem(found);
    if (found) return;
    await props.onAdd({ title: title.trim(), start_date: start, end_date: end, effect });
    setTitle("");
    setStart("");
    setEnd("");
  }

  return (
    <form onSubmit={submit} className="mt-4 space-y-2">
      <div className="font-medium">Add dates</div>
      {props.kind === "SCHOOL" && (
        <div className="flex flex-wrap gap-1">
          {PRESETS.map((p) => (
            <button key={p} type="button" onClick={() => { setTitle(p); setEffect("DAY_OFF"); }} className="rounded-full border border-zinc-300 px-2 py-0.5 text-xs dark:border-zinc-700">
              {p}
            </button>
          ))}
        </div>
      )}
      <label className="block">
        <span className="text-xs text-zinc-500">Name</span>
        <input value={title} maxLength={200} onChange={(e) => setTitle(e.target.value)} className={input} />
      </label>
      <div className="flex gap-2">
        <label className="flex-1">
          <span className="text-xs text-zinc-500">First day</span>
          <input type="date" value={start} onChange={(e) => { setStart(e.target.value); if (!end) setEnd(e.target.value); }} className={input} />
        </label>
        <label className="flex-1">
          <span className="text-xs text-zinc-500">Last day</span>
          <input type="date" value={end} onChange={(e) => setEnd(e.target.value)} className={input} />
        </label>
      </div>
      <label className="block">
        <span className="text-xs text-zinc-500">This means</span>
        <select value={effect} onChange={(e) => setEffect(e.target.value as typeof effect)} className={input}>
          <option value="DAY_OFF">{effectLabel("DAY_OFF", props.kind)} (a free day)</option>
          <option value="BUSY">Busy (a trip can&apos;t include it)</option>
        </select>
      </label>
      {problem && <p role="alert" className="text-red-700">{problem}</p>}
      <button type="submit" className="rounded bg-teal-700 px-3 py-1.5 font-medium text-white">Add</button>
    </form>
  );
}

/** Summer is the break people forget. Give us the last and next first day of school. */
function SummerHelper(props: { onAdd: (draft: NonNullable<ReturnType<typeof summerBreak>>) => Promise<void> }) {
  const [last, setLast] = useState("");
  const [next, setNext] = useState("");
  const draft = last && next ? summerBreak(last, next) : null;
  return (
    <div className="mt-4 space-y-2">
      <div className="font-medium">Summer break</div>
      <div className="flex gap-2">
        <label className="flex-1">
          <span className="text-xs text-zinc-500">Last day of school</span>
          <input type="date" value={last} onChange={(e) => setLast(e.target.value)} className={input} />
        </label>
        <label className="flex-1">
          <span className="text-xs text-zinc-500">First day next year</span>
          <input type="date" value={next} onChange={(e) => setNext(e.target.value)} className={input} />
        </label>
      </div>
      <button
        type="button"
        disabled={!draft}
        onClick={() => draft && props.onAdd(draft)}
        className="rounded border border-zinc-300 px-3 py-1.5 font-medium disabled:opacity-50 dark:border-zinc-700"
      >
        Add summer break
      </button>
    </div>
  );
}

function NewCalendar(props: {
  person: Person;
  kinds: { kind: CalendarKind; label: string }[];
  first: boolean;
  onCreate: (name: string, kind: CalendarKind) => Promise<void>;
}) {
  const [open, setOpen] = useState(props.first);
  const [kind, setKind] = useState<CalendarKind>(props.kinds[0].kind);
  const [name, setName] = useState("");
  const label = props.kinds.find((k) => k.kind === kind)?.label ?? "";

  if (!open && !props.first) {
    return <button onClick={() => setOpen(true)} className="mt-3 block text-xs font-medium text-teal-700 underline dark:text-teal-400">+ New calendar</button>;
  }
  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        await props.onCreate(name.trim() || `${props.person.name}'s ${label.toLowerCase()}`, kind);
        setName("");
        setOpen(false);
      }}
      className="mt-3 space-y-2"
    >
      <div className="font-medium">New calendar</div>
      <label className="block">
        <span className="text-xs text-zinc-500">What is it?</span>
        <select value={kind} onChange={(e) => setKind(e.target.value as CalendarKind)} className={input}>
          {props.kinds.map((k) => (
            <option key={k.kind} value={k.kind}>{k.label}</option>
          ))}
        </select>
      </label>
      <label className="block">
        <span className="text-xs text-zinc-500">Name (optional)</span>
        <input value={name} maxLength={200} onChange={(e) => setName(e.target.value)} placeholder={`${props.person.name}'s ${label.toLowerCase()}`} className={input} />
      </label>
      <button type="submit" className="rounded bg-teal-700 px-3 py-1.5 font-medium text-white">Create</button>
    </form>
  );
}
