"use client";

import { signOut, useSession } from "next-auth/react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";

import ProfileForm, { ErrorNote } from "@/components/ProfileForm";
import ReminderToggle from "@/components/ReminderToggle";
import { api, apiToken, errorMessage, type Me } from "@/lib/api";
import { federalSkips, skipsOn } from "@/lib/holidays";
import { saveHolidays, settingsTarget, updateBody, type Profile } from "@/lib/profile";

// useSearchParams needs a Suspense boundary so Next can still prerender the page shell.
export default function SettingsPage() {
  return (
    <Suspense fallback={null}>
      <Settings />
    </Suspense>
  );
}

/** Change your PTO, renewal, work week and holidays after setup, or those of an adult you manage (?person=). */
function Settings() {
  const router = useRouter();
  const params = useSearchParams();
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

  const person = me ? settingsTarget(me, params.get("person")) : undefined;
  const isSelf = person != null && person.id === me?.self_person_id;
  const personId = person?.id;

  // The holidays they skip live on their calendar link, not the person row.
  // undefined while loading; the form waits so it starts from what's saved.
  const [skips, setSkips] = useState<{ personId: number; skipped: string[] | null; company: string[] | null }>();
  useEffect(() => {
    if (personId == null) return;
    api
      .GET("/people/{person_id}/calendars", { params: { path: { person_id: personId } } })
      .then(({ data, error }) => {
        if (!data) throw error;
        setSkips({ personId, skipped: federalSkips(data), company: skipsOn(data, "COMPANY") });
      })
      .catch((err) => setError(errorMessage(err)));
  }, [personId]);

  async function save(profile: Profile) {
    if (!person) return;
    const { error } = await api.PUT("/people/{person_id}", {
      params: { path: { person_id: person.id } },
      body: updateBody(profile),
    });
    if (error) throw error;
    await saveHolidays(person.id, profile);
    router.push("/plan");
  }

  return (
    <main className="mx-auto w-full max-w-md px-4 py-12">
      <Link href="/plan" className="text-sm text-app-muted underline">Back to your plan</Link>
      <h1 className="mt-4 text-3xl font-semibold tracking-tight">Settings</h1>
      <p className="mt-2 text-app-muted">
        {isSelf ? "Update your PTO, work week and holidays." : `Update ${person?.name ?? "their"}'s PTO, work week and holidays.`} Your
        suggestions re-rank as soon as you save.
      </p>

      {error ? (
        <div className="mt-8"><ErrorNote>{error}</ErrorNote></div>
      ) : !me || (person && skips?.personId !== person.id) ? (
        <p className="mt-8 text-app-muted">Loading…</p>
      ) : !person || person.pto_balance == null ? (
        <p className="mt-8 text-app-muted">Set up your own profile first on the home page.</p>
      ) : (
        <ProfileForm
          key={person.id}
          initialName={person.name}
          nameLabel={isSelf ? undefined : "Their first name"}
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
            skippedHolidays: skips!.skipped,
            skippedCompanyDays: skips!.company,
          }}
          submitLabel="Save changes"
          savingLabel="Saving…"
          onSubmit={save}
        />
      )}

      {me && <ReminderToggle initial={me.reminders_on} />}

      {/* Sign out lives here now that the plan header is just a gear icon. */}
      {isSelf && (
        <button
          onClick={() => {
            apiToken.clear();
            signOut({ redirectTo: "/" });
          }}
          className="mt-6 w-full rounded-lg border border-app-line bg-app-surface px-4 py-2.5 font-medium text-app-danger"
        >
          Sign out
        </button>
      )}
    </main>
  );
}
