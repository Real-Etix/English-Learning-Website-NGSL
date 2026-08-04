"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export function SpaceName({ initialName }: { initialName: string | null }) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(initialName ?? "");
  const [saving, setSaving] = useState(false);

  const save = async () => {
    setSaving(true);
    await fetch("/api/me", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ displayName: name }),
    }).catch(() => {});
    setSaving(false);
    setEditing(false);
    router.refresh();
  };

  if (editing) {
    return (
      <div className="flex flex-wrap items-center gap-2">
        <input
          autoFocus
          value={name}
          maxLength={40}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && save()}
          placeholder="Name your space…"
          className="rounded-lg border border-white/20 bg-white/10 px-3 py-1.5 text-2xl font-semibold text-white outline-none focus:border-sky-400"
        />
        <button
          onClick={save}
          disabled={saving}
          className="rounded-full bg-sky-400 px-3 py-1.5 text-sm font-semibold text-slate-900 disabled:opacity-50"
        >
          {saving ? "Saving…" : "Save"}
        </button>
        <button onClick={() => setEditing(false)} className="text-sm text-slate-400 hover:text-white">
          Cancel
        </button>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-3">
      <h1 className="text-4xl font-semibold">{initialName ?? "My Space"}</h1>
      <button
        onClick={() => setEditing(true)}
        className="rounded-full border border-white/15 px-2.5 py-1 text-xs text-slate-300 transition hover:bg-white/10"
      >
        ✎ Rename
      </button>
    </div>
  );
}

export function ResetSpaceButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  const reset = async () => {
    if (!window.confirm("Reset your space? This removes all your collected words (your share link stays the same).")) {
      return;
    }
    setBusy(true);
    await fetch("/api/me", { method: "DELETE" }).catch(() => {});
    setBusy(false);
    router.refresh();
  };

  return (
    <button
      onClick={reset}
      disabled={busy}
      className="rounded-full border border-rose-400/30 bg-rose-500/10 px-4 py-2 text-sm font-semibold text-rose-200 transition hover:bg-rose-500/20 disabled:opacity-50"
    >
      {busy ? "Resetting…" : "Reset space"}
    </button>
  );
}
