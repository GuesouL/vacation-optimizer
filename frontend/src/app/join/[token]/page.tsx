"use client";

import { signIn, useSession } from "next-auth/react";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import ProfileForm, { ErrorNote } from "@/components/ProfileForm";
import { api, errorMessage, type Me } from "@/lib/api";
import { ensureSelf, type Profile } from "@/lib/profile";

type Preview = { group_name: string; invited_by: string; kind: "INVITE" | "VIEW" };

/** Where an invite link lands: see who invited you, sign in, then join. */
export default function JoinPage() {
  const { token } = useParams<{ token: string }>();
  const router = useRouter();
  const { status } = useSession();
  const [preview, setPreview] = useState<Preview | null>(null);
  const [me, setMe] = useState<Me | null>(null);
  const [bring, setBring] = useState<number[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [joining, setJoining] = useState(false);

  useEffect(() => {
    api
      .GET("/links/{token}", { params: { path: { token } } })
      .then(({ data, error }) => {
        if (!data) throw error;
        if (data.kind === "VIEW") router.replace(`/view/${token}`);
        else setPreview(data);
      })
      .catch((err) => setError(errorMessage(err)));
  }, [token, router]);

  useEffect(() => {
    if (status !== "authenticated") return;
    api
      .GET("/me")
      .then(({ data, error }) => {
        if (!data) throw error;
        setMe(data);
        setBring(data.people.map((p) => p.id)); // everyone you manage, untick to leave someone out
      })
      .catch((err) => setError(errorMessage(err)));
  }, [status]);

  async function join(personIds: number[]) {
    const joined = await api.POST("/links/{token}/accept", {
      params: { path: { token } },
      body: { person_ids: personIds },
    });
    if (!joined.data) throw joined.error;
    router.push(`/plan?group=${joined.data.id}`);
  }

  async function joinAsNewPerson(profile: Profile) {
    if (!me) return;
    await join([await ensureSelf(me, profile)]);
  }

  async function joinWithPeople() {
    setJoining(true);
    try {
      await join(bring);
    } catch (err) {
      setError(errorMessage(err));
      setJoining(false);
    }
  }

  return (
    <main className="mx-auto w-full max-w-md px-4 py-12">
      {error ? (
        <ErrorNote>{error}</ErrorNote>
      ) : !preview ? (
        <p className="text-zinc-500">Checking your invite…</p>
      ) : (
        <>
          <p className="text-sm font-medium text-teal-700 dark:text-teal-400">
            {preview.invited_by} invited you
          </p>
          <h1 className="mt-1 text-3xl font-semibold tracking-tight">{preview.group_name}</h1>
          <p className="mt-2 text-zinc-600 dark:text-zinc-400">
            Join to find the breaks that work for everyone. Others in the group see your
            name and which days you&apos;re free, never your PTO balance or why you&apos;re busy.
          </p>

          {status === "unauthenticated" ? (
            <button
              onClick={() => signIn(undefined, { redirectTo: `/join/${token}` })}
              className="mt-8 w-full rounded-lg bg-teal-700 px-4 py-2.5 font-medium text-white hover:bg-teal-800"
            >
              Sign in to join
            </button>
          ) : !me ? (
            <p className="mt-8 text-zinc-500">Loading…</p>
          ) : me.self_person_id == null ? (
            <ProfileForm
              initialName={me.name}
              submitLabel="Join the trip"
              savingLabel="Joining…"
              onSubmit={joinAsNewPerson}
            />
          ) : (
            <div className="mt-8 space-y-4">
              <fieldset>
                <legend className="text-sm font-medium">Who&apos;s coming?</legend>
                {me.people.map((person) => (
                  <label key={person.id} className="mt-2 flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={bring.includes(person.id)}
                      onChange={(e) =>
                        setBring((ids) =>
                          e.target.checked ? [...ids, person.id] : ids.filter((id) => id !== person.id),
                        )
                      }
                    />
                    <span>{person.name}</span>
                  </label>
                ))}
              </fieldset>
              <button
                onClick={joinWithPeople}
                disabled={joining || bring.length === 0}
                className="w-full rounded-lg bg-teal-700 px-4 py-2.5 font-medium text-white hover:bg-teal-800 disabled:opacity-50"
              >
                {joining ? "Joining…" : "Join the trip"}
              </button>
            </div>
          )}
        </>
      )}
    </main>
  );
}
