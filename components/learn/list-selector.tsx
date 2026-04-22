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
                ? "border-cyan-500/50 bg-cyan-50 text-slate-900 shadow-md shadow-cyan-200/50"
                : "border-slate-200 bg-white text-slate-800 shadow-sm hover:border-slate-300 hover:bg-slate-50"
            }`}
          >
            <div className="text-xs uppercase tracking-[0.2em] text-slate-500">
              {list.shortLabel}
            </div>
            <div className="mt-2 text-lg font-semibold">{list.title}</div>
            <p className="mt-2 text-sm leading-6 text-slate-600">{list.subtitle}</p>
            <div className="mt-3 text-xs text-slate-500">{list.wordCount} imported words</div>
          </Link>
        );
      })}
    </div>
  );
}
