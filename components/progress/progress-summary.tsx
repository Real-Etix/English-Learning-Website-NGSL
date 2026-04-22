"use client";

import { useSyncExternalStore } from "react";

import {
  emptyProgressRecord,
  getListProgressCount,
  loadProgress,
  subscribeToProgress,
} from "@/lib/progress/progress-service";
import type { LearningListSlug } from "@/lib/types";

export function ProgressSummary({
  listSlug,
  wordCount,
}: {
  listSlug: LearningListSlug;
  wordCount: number;
}) {
  const progress = useSyncExternalStore(
    subscribeToProgress,
    loadProgress,
    () => emptyProgressRecord,
  );

  const learnedCount = getListProgressCount(progress, listSlug);
  const completion = wordCount > 0 ? Math.min(100, (learnedCount / wordCount) * 100) : 0;

  return (
    <section className="rounded-[2rem] border border-white/10 bg-white/5 p-6">
      <div className="flex items-end justify-between gap-4">
        <div>
          <div className="text-xs uppercase tracking-[0.2em] text-slate-400">
            Progress snapshot
          </div>
          <h2 className="mt-2 text-2xl font-semibold text-white">{learnedCount} words learned</h2>
        </div>
        <div className="text-right text-sm text-slate-300">
          <div>{progress.totalCorrect} correct answers</div>
          <div>{progress.totalAttempts} total attempts</div>
        </div>
      </div>

      <div className="mt-5">
        <div className="h-3 rounded-full bg-slate-900">
          <div
            className="h-3 rounded-full bg-gradient-to-r from-cyan-400 to-emerald-300"
            style={{ width: `${completion}%` }}
          />
        </div>
        <div className="mt-3 flex justify-between text-sm text-slate-400">
          <span>List completion</span>
          <span>{completion.toFixed(1)}%</span>
        </div>
      </div>
    </section>
  );
}
