"use client";

import Link from "next/link";

import ScheduleEditor from "@/components/ScheduleEditor";
import Sheet from "@/components/Sheet";
import type { Group, PersonSchedule } from "@/lib/api";
import { personLine } from "@/lib/people";

type Member = Group["people"][number];
export type Opened = { id: number; schedule: boolean } | null; // whose sheet, and is the schedule editor open

/**
 * The People tab: one tidy row per person. Tapping a row opens their sheet with
 * everything you can do for them (schedule, show on calendar, edit, remove), so
 * the list itself stays quiet.
 */
export default function PeopleList(props: {
  group: Group;
  selfId: number | null | undefined;
  schedules: PersonSchedule[];
  hidden: number[];
  opened: Opened;
  onOpen: (opened: Opened) => void;
  onToggleDates: (personId: number, show: boolean) => void;
  onRemove: (personId: number) => void;
  onChanged: () => void;
}) {
  const { group, selfId, opened } = props;
  const person = group.people.find((p) => p.id === opened?.id);

  return (
    <>
      <ul className="divide-y divide-app-line overflow-hidden rounded-2xl bg-app-surface shadow-sm">
        {group.people.map((p) => (
          <li key={p.id}>
            <button
              onClick={() => props.onOpen({ id: p.id, schedule: false })}
              className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-app-soft"
            >
              <Avatar name={p.name} />
              <span className="min-w-0 flex-1">
                <span className="block font-medium">{p.name}</span>
                <span className="block truncate text-sm text-app-muted">{personLine(p, selfId)}</span>
              </span>
              <span aria-hidden="true" className="text-app-muted">›</span>
            </button>
          </li>
        ))}
      </ul>

      <Sheet open={!!person} onClose={() => props.onOpen(null)} label={person ? `${person.name}'s details` : "Details"}>
        {person && <PersonDetail {...props} person={person} />}
      </Sheet>
    </>
  );
}

function Avatar({ name }: { name: string }) {
  return (
    <span aria-hidden="true" className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-app-soft font-bold text-app-soft-ink">
      {name.charAt(0).toUpperCase()}
    </span>
  );
}

function PersonDetail(props: Parameters<typeof PeopleList>[0] & { person: Member }) {
  const { person: p, group, selfId, opened } = props;
  const items = props.schedules.find((s) => s.person_id === p.id)?.items.length ?? 0;
  const canRemove = group.role === "OWNER" ? p.id !== selfId : p.mine;
  const row = "flex w-full items-center justify-between gap-2 px-4 py-3 text-left";

  function remove() {
    // Removing changes everyone's suggestions, so ask first.
    if (window.confirm(`${p.mine ? "Take" : "Remove"} ${p.name} out of this plan?`)) {
      props.onOpen(null);
      props.onRemove(p.id);
    }
  }

  return (
    <div>
      <div className="flex items-center gap-3">
        <Avatar name={p.name} />
        <div>
          <h2 className="text-lg font-semibold">{p.name}</h2>
          <p className="text-sm text-app-muted">{personLine(p, selfId)}</p>
        </div>
      </div>

      <div className="mt-4 divide-y divide-app-line rounded-xl bg-app-tile/40">
        {p.mine && (
          <button onClick={() => props.onOpen({ id: p.id, schedule: !opened?.schedule })} className={row} aria-expanded={opened?.schedule}>
            <span>Schedule</span>
            <span className="text-sm text-app-muted">{items ? `${items} dates` : "None yet"} ›</span>
          </button>
        )}
        {items > 0 && (
          <label className={`${row} cursor-pointer`}>
            <span>Show on calendar</span>
            <input
              type="checkbox"
              className="h-5 w-5 accent-app-accent"
              checked={!props.hidden.includes(p.id)}
              onChange={(e) => props.onToggleDates(p.id, e.target.checked)}
            />
          </label>
        )}
        {p.mine && p.kind === "ADULT" && (
          <Link href={`/settings?person=${p.id}`} className={row}>
            <span>Edit details</span>
            <span className="text-sm text-app-muted">›</span>
          </Link>
        )}
      </div>

      {opened?.schedule && p.mine && (
        <ScheduleEditor
          person={p}
          onChanged={props.onChanged} // new dates change every suggestion: re-rank
          onClose={() => props.onOpen({ id: p.id, schedule: false })}
        />
      )}

      {canRemove && (
        <button onClick={remove} className="mt-4 w-full rounded-xl border border-app-line px-4 py-2.5 font-medium text-app-danger">
          {p.mine ? "Take out of this plan" : "Remove from this plan"}
        </button>
      )}
      {!p.mine && !canRemove && (
        <p className="mt-4 text-sm text-app-muted">{p.name} manages their own details.</p>
      )}
    </div>
  );
}
