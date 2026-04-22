import Link from "next/link";
import { notFound } from "next/navigation";

import { WordCatalog } from "@/components/catalog/word-catalog";
import { ListSelector } from "@/components/learn/list-selector";
import { ListenTypeQuiz } from "@/components/quiz/listen-type-quiz";
import { ProgressSummary } from "@/components/progress/progress-summary";
import { fetchFreePronunciationAudio } from "@/lib/audio/free-pronunciation";
import { hydrateLearningWords } from "@/lib/content/source-enrichment";
import {
  getAllLists,
  getCatalogWordsForList,
  getListBySlug,
  getPracticeWordsForList,
} from "@/lib/content/content-service";
import type { LearningListSlug, PracticeMode } from "@/lib/types";

function normalizePracticeMode(value: string | undefined): PracticeMode {
  if (value === "meaning_match") {
    return "meaning_match";
  }

  if (value === "study_card" || value === "example_builder" || value === "conversation_context" || value === "phrase_explorer") {
    return "study_card";
  }

  return "listen_type";
}

export default async function LearnListPage({
  params,
  searchParams,
}: {
  params: Promise<{ listSlug: string }>;
  searchParams: Promise<{ mode?: string }>;
}) {
  const { listSlug } = await params;
  const resolvedSearchParams = await searchParams;
  const list = getListBySlug(listSlug as LearningListSlug);
  const initialMode = normalizePracticeMode(resolvedSearchParams.mode);

  if (!list) {
    notFound();
  }

  const practiceWords = await hydrateLearningWords(getPracticeWordsForList(list.slug, 10));
  const catalogWords = await hydrateLearningWords(getCatalogWordsForList(list.slug, 18));
  const initialPronunciation = practiceWords[0]
    ? await fetchFreePronunciationAudio(practiceWords[0].lemma)
    : { audioUrl: null, sourceLabel: "Free dictionary audio not found" };

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-8 px-6 py-12">
      <section className="rounded-[2rem] border border-slate-200 bg-white p-8 shadow-sm">
        <div className="text-xs uppercase tracking-[0.2em] text-cyan-700">
          {list.shortLabel}
        </div>
        <h1 className="mt-3 text-4xl font-semibold text-slate-900">{list.title}</h1>
        <p className="mt-4 max-w-3xl text-lg leading-8 text-slate-600">
          {list.description}
        </p>
        <p className="mt-3 max-w-2xl text-sm leading-7 text-slate-500">{list.moodHook}</p>
        <div className="mt-6 flex flex-wrap gap-3">
          <Link
            href={`/lists/${list.slug}`}
            className="rounded-full border border-cyan-400/60 px-4 py-2 text-sm font-medium text-cyan-800 transition hover:bg-cyan-50"
          >
            Browse full vocabulary
          </Link>
        </div>
      </section>

      <ListSelector lists={getAllLists()} currentSlug={list.slug} />

      <div className="grid gap-6 xl:grid-cols-[0.9fr_1.1fr]">
        <ProgressSummary listSlug={list.slug} wordCount={list.wordCount} />
        <section className="rounded-[2rem] border border-slate-200 bg-white p-6 shadow-sm">
          <div className="text-xs uppercase tracking-[0.2em] text-slate-500">
            Study guidance
          </div>
          <p className="mt-4 text-sm leading-7 text-slate-600">
            The strongest study loop here is listening and meaning practice, with a
            dedicated study card for fixed examples, phrases, and references.
          </p>
          <div className="mt-4 rounded-3xl border border-slate-100 bg-slate-50 px-4 py-4 text-sm text-slate-700">
            Word cards and practice items prefer source-backed content first, then fall
            back only when trustworthy fixed content is still missing.
          </div>
          <div className="mt-4 rounded-3xl border border-slate-100 bg-slate-50 px-4 py-4 text-sm text-slate-700">
            Tip: if free dictionary audio is available, the pronunciation player will use
            that first. Otherwise it falls back to the browser voice.
          </div>
        </section>
      </div>

      <ListenTypeQuiz
        key={`${list.slug}-${initialMode}`}
        words={practiceWords}
        listSlug={list.slug}
        initialMode={initialMode}
        initialPronunciation={initialPronunciation}
      />

      <WordCatalog
        title={`${list.title} catalog`}
        description="Browse source-backed cards for this list. Open a word page for the full fixed content view."
        words={catalogWords}
      />
    </div>
  );
}
