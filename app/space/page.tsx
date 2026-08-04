import { cookies } from "next/headers";
import Link from "next/link";

import { RecoveryKey } from "@/components/collection/recovery-key";
import { ShareButton } from "@/components/collection/share-button";
import { ResetSpaceButton, SpaceName } from "@/components/collection/space-controls";
import { GalaxyClient } from "@/components/network/galaxy-client";
import { getMySummary } from "@/lib/collection/service";
import { loadCollectionGraph } from "@/lib/wiki/graph-store";

export const dynamic = "force-dynamic"; // reads the owner cookie + DB

export default async function SpacePage() {
  const token = (await cookies()).get("ownerToken")?.value;
  const me = await getMySummary(token);

  if (!me || me.wordCount === 0) {
    return (
      <div className="mx-auto max-w-3xl px-6 py-24 text-center">
        <div className="text-5xl">🌌</div>
        <h1 className="mt-4 text-3xl font-semibold text-slate-900">Your space is empty</h1>
        <p className="mt-3 text-lg leading-8 text-slate-600">
          Explore the galaxy and collect words to build your own universe — each one earns XP.
        </p>
        <Link
          href="/network/ngsl"
          className="mt-6 inline-flex rounded-full bg-cyan-500 px-6 py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-cyan-600"
        >
          Explore the galaxy →
        </Link>
        <p className="mt-4 text-sm text-slate-500">
          Have a space on another device?{" "}
          <Link href="/restore" className="font-medium text-cyan-700 hover:text-cyan-900">
            Restore it with your recovery key
          </Link>
          .
        </p>
      </div>
    );
  }

  const graph = await loadCollectionGraph(new Set(me.lemmas));

  return (
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-8 px-6 py-12">
      <section className="overflow-hidden rounded-[2rem] border border-white/10 bg-gradient-to-br from-[#0a0f24] via-[#0b1027] to-[#120a2a] p-8 text-slate-100 shadow-sm">
        <div className="text-xs uppercase tracking-[0.2em] text-sky-300">Your vocabulary space</div>
        <div className="mt-3">
          <SpaceName initialName={me.displayName} />
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-3 text-sm">
          <span className="rounded-full bg-sky-400/20 px-3 py-1 font-semibold text-sky-200">
            Level {me.level}
          </span>
          <span className="text-slate-300">{me.totalXp} XP</span>
          <span className="text-slate-400">· {me.wordCount} words</span>
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          {me.badges.map((b) => (
            <span
              key={b.id}
              className={`rounded-full px-3 py-1 text-xs ${
                b.earned
                  ? "bg-violet-500/20 text-violet-200"
                  : "border border-white/10 text-slate-500"
              }`}
            >
              {b.earned ? "🏅 " : "🔒 "}
              {b.label}
            </span>
          ))}
        </div>
        <div className="mt-6 flex flex-wrap gap-3">
          <ShareButton slug={me.slug} />
          <ResetSpaceButton />
        </div>
        <div className="mt-4 max-w-xl">
          <RecoveryKey token={token ?? ""} />
        </div>
      </section>

      <GalaxyClient graph={graph} />
    </div>
  );
}
