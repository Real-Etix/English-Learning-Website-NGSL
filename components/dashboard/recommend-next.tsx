"use client";

import Link from "next/link";
import { useSyncExternalStore } from "react";

import {
  emptyProgressRecord,
  loadProgress,
  subscribeToProgress,
} from "@/lib/progress/progress-service";
import type { LearningListSlug } from "@/lib/types";

export function RecommendNext({
  lists,
}: {
  lists: Array<{
    slug: LearningListSlug;
    title: string;
    moodHook: string;
  }>;
}) {
  const progress = useSyncExternalStore(
    subscribeToProgress,
    loadProgress,
    () => emptyProgressRecord,
  );
  const hardestWord = progress.difficultWords[0];
  const recommendedSlug =
    hardestWord?.includes("protein") || hardestWord?.includes("recover")
      ? "fitness"
      : hardestWord?.includes("client") || hardestWord?.includes("budget")
        ? "business"
        : hardestWord?.includes("analysis")
          ? "academic"
          : "ngsl";

  const recommended = lists.find((list) => list.slug === recommendedSlug) ?? lists[0];

  if (!recommended) {
    return null;
  }

  return (
    <section className="rounded-[2rem] border border-cyan-200 bg-cyan-50 p-6 shadow-sm">
      <div className="text-xs uppercase tracking-[0.2em] text-cyan-800">
        Recommended next session
      </div>
      <h2 className="mt-2 text-2xl font-semibold text-slate-900">{recommended.title}</h2>
      <p className="mt-3 max-w-2xl text-sm leading-7 text-cyan-950/90">
        {recommended.moodHook}
      </p>
      <Link
        href={`/learn/${recommended.slug}`}
        className="mt-5 inline-flex rounded-full bg-cyan-500 px-5 py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-cyan-600"
      >
        Start this practice path
      </Link>
    </section>
  );
}
