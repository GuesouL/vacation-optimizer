"use client";

import { useState } from "react";

import ProfileForm from "@/components/ProfileForm";
import { api } from "@/lib/api";
import { createAdult, type Profile } from "@/lib/profile";

/**
 * Add a partner (or any adult who won't sign in) to the group. It's the same form
 * as onboarding: their own PTO, work week and holidays. You manage them, so you
 * can edit their PTO and schedule later. To share the plan with someone who has
 * their own login, use an invite link instead.
 */
export default function AddAdult({ groupId, onAdded }: { groupId: number; onAdded: (personId: number) => void }) {
  const [open, setOpen] = useState(false);

  async function add(profile: Profile) {
    // Two calls: the person (with their holidays), then into this group.
    const personId = await createAdult(profile, false);
    const added = await api.POST("/groups/{group_id}/members", {
      params: { path: { group_id: groupId } },
      body: { person_ids: [personId] },
    });
    if (!added.data) throw added.error;
    setOpen(false);
    onAdded(personId);
  }

  if (!open) {
    return (
      <button onClick={() => setOpen(true)} className="mt-2 block text-sm font-medium text-teal-700 underline dark:text-teal-400">
        + Add a partner or another adult
      </button>
    );
  }

  return (
    <div className="mt-3 rounded-lg border border-zinc-200 p-3 dark:border-zinc-800">
      <ProfileForm
        nameLabel="Their first name"
        initialName=""
        submitLabel="Add to this plan"
        savingLabel="Adding…"
        onSubmit={add}
      />
      <button onClick={() => setOpen(false)} className="mt-3 text-sm text-zinc-500 underline">Cancel</button>
    </div>
  );
}
