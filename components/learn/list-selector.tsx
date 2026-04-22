import Link from "next/link";

import type { LearningListSlug, WordListData } from "@/lib/types";

export function ListSelector({
  lists,
  currentSlug,
  mood,
}: {
  lists: WordListData[];
  currentSlug?: LearningListSlug;
  mood?: string;
}) {
  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
      {lists.map((list) => {
        const isActive = list.slug === currentSlug;
        const href = mood ? `/learn/${list.slug}?mood=${mood}` : `/learn/${list.slug}`;

        return (
          <Link
            key={list.slug}
            href={href}
            className={`rounded-3xl border px-4 py-4 transition ${
              isActive
                ? "border-cyan-400/70 bg-cyan-400/10 text-white shadow-lg shadow-cyan-950/40"
                : "border-white/10 bg-white/5 text-slate-200 hover:border-white/20 hover:bg-white/10"
            }`}
          >
            <div className="text-xs uppercase tracking-[0.2em] text-slate-400">
              {list.shortLabel}
            </div>
            <div className="mt-2 text-lg font-semibold">{list.title}</div>
            <p className="mt-2 text-sm leading-6 text-slate-300">{list.subtitle}</p>
            <div className="mt-3 text-xs text-slate-400">{list.wordCount} imported words</div>
          </Link>
        );
      })}
    </div>
  );
}
