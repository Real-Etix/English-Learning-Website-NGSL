import Link from "next/link";

import { getLeaderboard } from "@/lib/collection/service";

export const dynamic = "force-dynamic"; // live standings from the DB

const MEDAL = ["🥇", "🥈", "🥉"];

export default async function LeaderboardPage() {
  const entries = await getLeaderboard(25).catch(() => []);

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-8 px-6 py-12">
      <section className="overflow-hidden rounded-[2rem] border border-white/10 bg-gradient-to-br from-[#0a0f24] via-[#0b1027] to-[#120a2a] p-8 text-slate-100 shadow-sm">
        <div className="text-xs uppercase tracking-[0.2em] text-sky-300">Explorers</div>
        <h1 className="mt-3 text-4xl font-semibold">Leaderboard</h1>
        <p className="mt-3 text-slate-300">Top vocabulary spaces by XP. Collect words to climb.</p>
      </section>

      {entries.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-10 text-center text-slate-500">
          No explorers yet — <Link href="/network/ngsl" className="font-medium text-cyan-700">be the first</Link>.
        </div>
      ) : (
        <ol className="space-y-2">
          {entries.map((e) => (
            <li key={e.slug}>
              <Link
                href={`/g/${e.slug}`}
                className="flex items-center gap-4 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm transition hover:border-cyan-300 hover:bg-sky-50"
              >
                <span className="w-8 text-center text-lg font-semibold text-slate-500">
                  {MEDAL[e.rank - 1] ?? e.rank}
                </span>
                <span className="flex-1 truncate font-semibold text-slate-900">
                  {e.displayName ?? e.slug}
                </span>
                <span className="rounded-full bg-sky-100 px-2.5 py-1 text-xs font-semibold text-sky-800">
                  Lv {e.level}
                </span>
                <span className="w-20 text-right text-sm text-slate-500">{e.totalXp} XP</span>
                <span className="hidden w-20 text-right text-sm text-slate-400 sm:block">
                  {e.wordCount} words
                </span>
              </Link>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
