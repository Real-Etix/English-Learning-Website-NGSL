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
    <section className="rounded-[2rem] border border-slate-200 bg-white p-6 shadow-sm">
      <div className="flex items-end justify-between gap-4">
        <div>
          <div className="text-xs uppercase tracking-[0.2em] text-slate-500">
            Progress snapshot
          </div>
          <h2 className="mt-2 text-2xl font-semibold text-slate-900">{learnedCount} words learned</h2>
        </div>
        <div className="text-right text-sm text-slate-600">
          <div>{progress.totalCorrect} correct answers</div>
          <div>{progress.totalAttempts} total attempts</div>
        </div>
      </div>

      <div className="mt-5">
        <div className="h-3 rounded-full bg-slate-200">
          <div
            className="h-3 rounded-full bg-gradient-to-r from-cyan-500 to-emerald-500"
            style={{ width: `${completion}%` }}
          />
        </div>
        <div className="mt-3 flex justify-between text-sm text-slate-500">
          <span>List completion</span>
          <span>{completion.toFixed(1)}%</span>
        </div>
      </div>
    </section>
  );
}
