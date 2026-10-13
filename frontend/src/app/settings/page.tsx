"use client";

import { useSession } from "next-auth/react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import ProfileForm, { ErrorNote } from "@/components/ProfileForm";
import { api, errorMessage, type Me } from "@/lib/api";
import { updateBody, type Profile } from "@/lib/profile";

/** Change your name, PTO, renewal and work week after setup. */
export default function Settings() {
  const router = useRouter();
  const { status } = useSession();
  const [me, setMe] = useState<Me | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (status === "unauthenticated") router.replace("/");
    if (status !== "authenticated") return;
    api
      .GET("/me")
      .then(({ data, error }) => {
        if (!data) throw error;
        setMe(data);
      })
      .catch((err) => setError(errorMessage(err)));
  }, [status, router]);

  const person = me?.people.find((p) => p.id === me.self_person_id);

  async function save(profile: Profile) {
    if (!person) return;
    const { error } = await api.PUT("/people/{person_id}", {
      params: { path: { person_id: person.id } },
      body: updateBody(profile),
    });
    if (error) throw error;
    router.push("/plan");
  }

  return (
    <main className="mx-auto w-full max-w-md px-4 py-12">
      <Link href="/plan" className="text-sm text-zinc-500 underline">Back to your plan</Link>
      <h1 className="mt-4 text-3xl font-semibold tracking-tight">Settings</h1>
      <p className="mt-2 text-zinc-600 dark:text-zinc-400">
        Update your PTO and work week. Your suggestions re-rank as soon as you save.
      </p>

      {error ? (
        <div className="mt-8"><ErrorNote>{error}</ErrorNote></div>
      ) : !me ? (
        <p className="mt-8 text-zinc-500">Loading…</p>
      ) : !person || person.pto_balance == null ? (
        <p className="mt-8 text-zinc-500">Set up your own profile first on the home page.</p>
      ) : (
        <ProfileForm
          initialName={person.name}
          current={{
            ptoBalance: person.pto_balance,
            workWeek: person.work_week,
            renewal:
              person.pto_allowance != null && person.pto_renews_on
                ? {
                    allowance: person.pto_allowance,
                    month: person.pto_renews_on.month,
                    day: person.pto_renews_on.day,
                    carryoverMax: person.pto_carryover_max ?? 0,
                  }
                : null,
          }}
          submitLabel="Save changes"
          savingLabel="Saving…"
          onSubmit={save}
        />
      )}
    </main>
  );
}
