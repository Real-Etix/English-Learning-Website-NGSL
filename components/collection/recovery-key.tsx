"use client";

import Link from "next/link";
import { useState } from "react";

export function RecoveryKey({ token }: { token: string }) {
  const [revealed, setRevealed] = useState(false);
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    await navigator.clipboard.writeText(token).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div className="rounded-xl border border-white/10 bg-white/5 p-4">
      <div className="flex items-center justify-between">
        <div className="text-xs font-semibold text-slate-200">🔑 Recovery key</div>
        <Link href="/restore" className="text-xs text-sky-300 hover:text-sky-200">
          Restore a space →
        </Link>
      </div>
      <p className="mt-1 text-xs leading-5 text-slate-400">
        Save this to restore your space on another device or browser (there&apos;s no login).
        Anyone with it can open your space, so keep it private.
      </p>
      <div className="mt-2 flex items-center gap-2">
        <code className="flex-1 truncate rounded bg-black/30 px-2 py-1.5 font-mono text-xs text-sky-200">
          {revealed ? token : "•".repeat(28)}
        </code>
        <button
          onClick={() => setRevealed((v) => !v)}
          className="rounded border border-white/15 px-2 py-1 text-xs text-slate-300 hover:bg-white/10"
        >
          {revealed ? "Hide" : "Reveal"}
        </button>
        <button
          onClick={copy}
          className="rounded bg-sky-400 px-2.5 py-1 text-xs font-semibold text-slate-900 hover:bg-sky-300"
        >
          {copied ? "Copied ✓" : "Copy"}
        </button>
      </div>
    </div>
  );
}
