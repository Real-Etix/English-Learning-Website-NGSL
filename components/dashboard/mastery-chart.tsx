"use client";

import { useSyncExternalStore } from "react";

import {
  emptyProgressRecord,
  getListProgressCount,
  loadProgress,
  subscribeToProgress,
} from "@/lib/progress/progress-service";
import type { LearningListSlug } from "@/lib/types";

export function MasteryChart({
  lists,
}: {
  lists: Array<{ slug: LearningListSlug; title: string; wordCount: number }>;
}) {
  const progressLoaded = useSyncExternalStore(
    subscribeToProgress,
    loadProgress,
    () => emptyProgressRecord,
  );

  return (
    <section className="rounded-[2rem] border border-white/10 bg-white/5 p-6">
      <h2 className="text-2xl font-semibold text-white">Mastery by goal area</h2>
      <div className="mt-6 space-y-4">
        {lists.map((list) => {
          const learned = getListProgressCount(progressLoaded, list.slug);
          const percent = list.wordCount > 0 ? Math.min(100, (learned / list.wordCount) * 100) : 0;

          return (
            <div key={list.slug}>
              <div className="mb-2 flex items-center justify-between text-sm text-slate-300">
                <span>{list.title}</span>
                <span>
                  {learned} / {list.wordCount}
                </span>
              </div>
              <div className="h-3 rounded-full bg-slate-900">
                <div
                  className="h-3 rounded-full bg-gradient-to-r from-cyan-400 to-violet-400"
                  style={{ width: `${percent}%` }}
                />
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
