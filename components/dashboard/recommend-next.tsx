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
    <section className="rounded-[2rem] border border-cyan-400/20 bg-cyan-400/10 p-6">
      <div className="text-xs uppercase tracking-[0.2em] text-cyan-200">
        Recommended next session
      </div>
      <h2 className="mt-2 text-2xl font-semibold text-white">{recommended.title}</h2>
      <p className="mt-3 max-w-2xl text-sm leading-7 text-cyan-50/90">
        {recommended.moodHook}
      </p>
      <Link
        href={`/learn/${recommended.slug}`}
        className="mt-5 inline-flex rounded-full bg-cyan-300 px-5 py-3 text-sm font-semibold text-slate-950 transition hover:bg-cyan-200"
      >
        Start this practice path
      </Link>
    </section>
  );
}
