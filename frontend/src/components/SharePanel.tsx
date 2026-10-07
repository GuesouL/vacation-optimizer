"use client";

import { useEffect, useState } from "react";

import { api, errorMessage } from "@/lib/api";

type Link = { id: number; kind: "INVITE" | "VIEW"; expires_at: string; revoked: boolean };

const LABELS = { INVITE: "Invite link", VIEW: "View-only link" } as const;

/** Owner only: make, copy and revoke share links. */
export default function SharePanel({ groupId }: { groupId: number }) {
  const [links, setLinks] = useState<Link[]>([]);
  const [fresh, setFresh] = useState<{ id: number; url: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [version, setVersion] = useState(0); // bump to re-fetch after a change

  useEffect(() => {
    api
      .GET("/groups/{group_id}/links", { params: { path: { group_id: groupId } } })
      .then(({ data, error }) => {
        if (!data) throw error;
        setLinks(data);
      })
      .catch((err) => setError(errorMessage(err)));
  }, [groupId, version]);

  async function create(kind: Link["kind"]) {
    setError(null);
    setCopied(false);
    const { data, error } = await api.POST("/groups/{group_id}/links", {
      params: { path: { group_id: groupId } },
      body: { kind },
    });
    if (!data) return setError(errorMessage(error));
    const path = kind === "INVITE" ? "join" : "view";
    setFresh({ id: data.id, url: `${window.location.origin}/${path}/${data.token}` });
    setVersion((v) => v + 1);
  }

  async function revoke(id: number) {
    await api.DELETE("/groups/{group_id}/links/{link_id}", {
      params: { path: { group_id: groupId, link_id: id } },
    });
    if (fresh?.id === id) setFresh(null);
    setVersion((v) => v + 1);
  }

  async function copy(url: string) {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
    } catch {
      // Clipboard blocked: the link is still on screen to copy by hand.
    }
  }

  const live = links.filter((l) => !l.revoked && new Date(l.expires_at) > new Date());

  return (
    <div className="mt-4 space-y-3 text-sm">
      <div className="flex flex-wrap gap-2">
        <button onClick={() => create("INVITE")} className="rounded-lg bg-teal-700 px-3 py-1.5 font-medium text-white hover:bg-teal-800">
          New invite link
        </button>
        <button onClick={() => create("VIEW")} className="rounded-lg border border-zinc-300 px-3 py-1.5 font-medium hover:border-zinc-500 dark:border-zinc-700">
          New view-only link
        </button>
      </div>

      {fresh && (
        <div className="rounded-lg bg-teal-50 p-3 dark:bg-teal-950">
          <p className="font-medium">Copy it now. For safety it&apos;s only shown once.</p>
          <div className="mt-2 flex gap-2">
            <input readOnly value={fresh.url} onFocus={(e) => e.target.select()} aria-label="New link"
              className="min-w-0 flex-1 rounded border border-zinc-300 bg-white px-2 py-1 font-mono text-xs dark:border-zinc-700 dark:bg-zinc-900" />
            <button onClick={() => copy(fresh.url)} className="rounded bg-teal-700 px-2 py-1 text-white">
              {copied ? "Copied" : "Copy"}
            </button>
          </div>
        </div>
      )}

      {live.length > 0 && (
        <ul className="space-y-1">
          {live.map((link) => (
            <li key={link.id} className="flex items-center justify-between gap-2 text-zinc-600 dark:text-zinc-400">
              <span>
                {LABELS[link.kind]} · expires {new Date(link.expires_at).toLocaleDateString()}
              </span>
              <button onClick={() => revoke(link.id)} className="text-red-700 underline dark:text-red-400">
                Revoke
              </button>
            </li>
          ))}
        </ul>
      )}
      {error && <p role="alert" className="text-red-700">{error}</p>}
    </div>
  );
}
