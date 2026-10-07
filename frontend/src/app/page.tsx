"use client";

import { signIn, useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { type FormEvent, useEffect, useState } from "react";

import { api, errorMessage, FEDERAL_CALENDAR_ID, type Me } from "@/lib/api";

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

export default function Home() {
  const router = useRouter();
  const { status } = useSession();
  const [me, setMe] = useState<Me | null>(null);
  const [name, setName] = useState("");
  const [pto, setPto] = useState("10");
  const [workWeek, setWorkWeek] = useState([0, 1, 2, 3, 4]);
  const [federal, setFederal] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // Signed in and already have a plan? Go straight to it.
  useEffect(() => {
    if (status !== "authenticated") return;
    api
      .GET("/me")
      .then(({ data, error }) => {
        if (!data) throw error;
        if (data.groups.length) router.replace("/plan");
        else {
          setMe(data);
          setName((current) => current || data.name);
        }
      })
      .catch((err) => setError(errorMessage(err)));
  }, [status, router]);

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
      // Three calls, in order: you, your holidays, then a group of one.
      // If a profile already exists (an earlier try stopped halfway), reuse it.
      let personId = me?.self_person_id;
      if (personId == null) {
        const person = await api.POST("/people", {
          body: { name: name.trim(), kind: "ADULT", pto_balance: Number(pto), work_week: workWeek, is_self: true },
        });
        if (!person.data) throw person.error;
        personId = person.data.id;
      }

      if (federal) {
        const link = await api.POST("/people/{person_id}/calendars", {
          params: { path: { person_id: personId } },
          body: { calendar_id: FEDERAL_CALENDAR_ID },
        });
        if (link.error) throw link.error;
      }

      const group = await api.POST("/groups", {
        body: { name: `${name.trim()}'s plan`, person_ids: [personId] },
      });
      if (!group.data) throw group.error;

      router.push("/plan");
    } catch (err) {
      setError(errorMessage(err));
      setSaving(false);
    }
  }

  const intro = (
    <>
      <h1 className="text-3xl font-semibold tracking-tight">Vacation Optimizer</h1>
      <p className="mt-2 text-zinc-600 dark:text-zinc-400">
        Find the most days off for the fewest PTO days.
      </p>
    </>
  );

  if (status === "unauthenticated") {
    return (
      <main className="mx-auto w-full max-w-md px-4 py-12">
        {intro}
        <button
          onClick={() => signIn()}
          className="mt-8 w-full rounded-lg bg-teal-700 px-4 py-2.5 font-medium text-white hover:bg-teal-800"
        >
          Sign in to start
        </button>
      </main>
    );
  }

  if (!me) {
    return (
      <main className="mx-auto w-full max-w-md px-4 py-12">
        {intro}
        {error ? (
          <p role="alert" className="mt-8 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800 dark:bg-red-950 dark:text-red-200">
            {error}
          </p>
        ) : (
          <p className="mt-8 text-zinc-500">Loading…</p>
        )}
      </main>
    );
  }

  return (
    <main className="mx-auto w-full max-w-md px-4 py-12">
      {intro}

      <form onSubmit={submit} className="mt-8 space-y-6">
        <label className="block">
          <span className="text-sm font-medium">Your first name</span>
          <input
            required
            maxLength={100}
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="mt-1 block w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 dark:border-zinc-700 dark:bg-zinc-900"
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
            className="mt-1 block w-32 rounded-lg border border-zinc-300 bg-white px-3 py-2 dark:border-zinc-700 dark:bg-zinc-900"
          />
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
                      ? "bg-teal-700 text-white"
                      : "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300"
                  }`}
                >
                  {label}
                </button>
              );
            })}
          </div>
        </fieldset>

        <label className="flex items-center gap-2">
          <input type="checkbox" checked={federal} onChange={(e) => setFederal(e.target.checked)} />
          <span className="text-sm">I get the US federal holidays off</span>
        </label>

        {error && (
          <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800 dark:bg-red-950 dark:text-red-200">
            {error}
          </p>
        )}

        <button
          type="submit"
          disabled={saving || workWeek.length === 0}
          className="w-full rounded-lg bg-teal-700 px-4 py-2.5 font-medium text-white hover:bg-teal-800 disabled:opacity-50"
        >
          {saving ? "Setting up…" : "Find my best breaks"}
        </button>
      </form>
    </main>
  );
}
