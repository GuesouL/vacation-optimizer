"use client";

import { signIn, useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import ProfileForm, { ErrorNote } from "@/components/ProfileForm";
import { api, errorMessage, type Me } from "@/lib/api";
import { ensureSelf, type Profile } from "@/lib/profile";

export default function Home() {
  const router = useRouter();
  const { status } = useSession();
  const [me, setMe] = useState<Me | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Signed in and already in a group? Go straight to the plan.
  useEffect(() => {
    if (status !== "authenticated") return;
    api
      .GET("/me")
      .then(({ data, error }) => {
        if (!data) throw error;
        if (data.groups.length) router.replace("/plan");
        else setMe(data);
      })
      .catch((err) => setError(errorMessage(err)));
  }, [status, router]);

  async function start(profile: Profile) {
    if (!me) return;
    // Two steps: you (with your holidays), then a group of one you can invite people to.
    const personId = await ensureSelf(me, profile);
    const group = await api.POST("/groups", {
      body: { name: `${profile.name}'s plan`, person_ids: [personId] },
    });
    if (!group.data) throw group.error;
    router.push("/plan");
  }

  return (
    <main className="mx-auto w-full max-w-md px-4 py-12">
      <h1 className="text-3xl font-semibold tracking-tight">Vacation Optimizer</h1>
      <p className="mt-2 text-zinc-600 dark:text-zinc-400">
        Find the most days off for the fewest PTO days.
      </p>

      {status === "unauthenticated" ? (
        <button
          onClick={() => signIn()}
          className="mt-8 w-full rounded-lg bg-teal-700 px-4 py-2.5 font-medium text-white hover:bg-teal-800"
        >
          Sign in to start
        </button>
      ) : error ? (
        <div className="mt-8"><ErrorNote>{error}</ErrorNote></div>
      ) : !me ? (
        <p className="mt-8 text-zinc-500">Loading…</p>
      ) : (
        <ProfileForm
          initialName={me.name}
          submitLabel="Find my best breaks"
          savingLabel="Setting up…"
          onSubmit={start}
        />
      )}
    </main>
  );
}
