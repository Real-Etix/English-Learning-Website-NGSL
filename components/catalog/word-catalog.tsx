import Link from "next/link";

import { SourceCreditBadges } from "@/components/content/source-credit-badges";
import type { LearningWord } from "@/lib/types";

function statusLabel(word: LearningWord) {
  return word.contentStatus === "fallback"
    ? "Fallback"
    : word.contentStatus === "manual_override"
      ? "Curated"
      : "Source-backed";
}

export function WordCatalog({
  title,
  description,
  words,
}: {
  title: string;
  description: string;
  words: LearningWord[];
}) {
  return (
    <section className="rounded-[2rem] border border-slate-200 bg-white p-6 shadow-sm">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <div className="text-xs uppercase tracking-[0.2em] text-cyan-700">
            Word catalog
          </div>
          <h2 className="mt-2 text-2xl font-semibold text-slate-900">{title}</h2>
          <p className="mt-3 max-w-3xl text-sm leading-7 text-slate-600">{description}</p>
        </div>
      </div>

      <div className="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {words.map((word) => (
          <Link
            key={word.normalizedLemma}
            href={`/word/${word.normalizedLemma}`}
            className="rounded-3xl border border-slate-200 bg-slate-50/80 p-5 transition hover:border-cyan-300 hover:bg-white hover:shadow-md"
          >
            <div className="flex items-center justify-between gap-3">
              <div className="text-lg font-semibold text-slate-900">{word.lemma}</div>
              <span className="rounded-full border border-slate-200 bg-white px-3 py-1 text-xs text-slate-600">
                {statusLabel(word)}
              </span>
            </div>
            <div className="mt-2 text-sm font-medium text-cyan-800">{word.partOfSpeech}</div>
            <p className="mt-3 text-sm leading-7 text-slate-600">{word.definition}</p>
            {word.exampleSentences[0] ? (
              <p className="mt-4 line-clamp-3 text-sm leading-6 text-slate-700">
                {word.exampleSentences[0].text}
              </p>
            ) : (
              <p className="mt-4 text-sm leading-6 text-slate-500">
                No sourced example has been generated for this word yet.
              </p>
            )}
            <div className="mt-4">
              <SourceCreditBadges credits={word.sourceCredits} asLinks={false} />
            </div>
          </Link>
        ))}
      </div>
    </section>
  );
}
