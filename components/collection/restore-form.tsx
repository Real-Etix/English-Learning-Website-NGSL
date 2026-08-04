"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export function RestoreForm() {
  const router = useRouter();
  const [key, setKey] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!key.trim() || busy) return;
    setBusy(true);
    setError("");
    const res = await fetch("/api/restore", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key: key.trim() }),
    }).catch(() => null);

    if (res?.ok) {
      router.push("/space");
      router.refresh();
      return;
    }
    const data = await res?.json().catch(() => ({}));
    setError(data?.error ?? "Could not restore that space.");
    setBusy(false);
  };

  return (
    <form onSubmit={submit} className="space-y-3">
      <input
        value={key}
        onChange={(e) => setKey(e.target.value)}
        placeholder="Paste your recovery key…"
        className="w-full rounded-xl border border-slate-300 px-4 py-3 font-mono text-sm text-slate-800 outline-none focus:border-cyan-400"
      />
      {error && <p className="text-sm text-rose-600">{error}</p>}
      <button
        type="submit"
        disabled={busy || !key.trim()}
        className="w-full rounded-full bg-cyan-500 px-6 py-3 text-sm font-semibold text-white transition hover:bg-cyan-600 disabled:opacity-50"
      >
        {busy ? "Restoring…" : "Restore my space"}
      </button>
    </form>
  );
}
