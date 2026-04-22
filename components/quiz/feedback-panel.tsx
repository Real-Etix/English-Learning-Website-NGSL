import Link from "next/link";

import { SourceCreditBadges } from "@/components/content/source-credit-badges";
import type { LearningWord, ReferenceItem } from "@/lib/types";

export function FeedbackPanel({
  word,
  references,
  title = "Correct answer",
  subtitle = "Open the full word page for a larger card view.",
}: {
  word: LearningWord;
  references: ReferenceItem[];
  title?: string;
  subtitle?: string;
}) {
  return (
    <section className="space-y-5 rounded-[2rem] border border-emerald-400/20 bg-emerald-400/10 p-6">
      <div>
        <div className="text-xs uppercase tracking-[0.2em] text-emerald-200">
          {title}
        </div>
        <h2 className="mt-2 text-3xl font-semibold text-white">{word.lemma}</h2>
        <p className="mt-2 text-sm text-emerald-100/80">
          {word.partOfSpeech} · {word.definition}
        </p>
        <p className="mt-3 text-sm text-emerald-100/70">{subtitle}</p>
        <div className="mt-4">
          <SourceCreditBadges credits={word.sourceCredits} />
        </div>
      </div>

      <div className="grid gap-5 lg:grid-cols-[1.3fr_0.9fr]">
        <div className="space-y-4">
          <div className="rounded-3xl border border-white/10 bg-slate-950/30 p-5">
            <h3 className="text-lg font-semibold text-white">Example sentences</h3>
            {word.exampleSentences.length > 0 ? (
              <div className="mt-4 space-y-4">
                {word.exampleSentences.map((sentence) => (
                  <div key={sentence.id} className="rounded-2xl bg-white/5 p-4">
                    <p className="text-sm leading-7 text-slate-100">{sentence.text}</p>
                    <p className="mt-2 text-sm text-slate-400">{sentence.explanation}</p>
                  </div>
                ))}
              </div>
            ) : (
              <div className="mt-4 rounded-2xl bg-white/5 p-4 text-sm text-slate-400">
                No trusted fixed examples have been generated for this word yet.
              </div>
            )}
          </div>

          <div className="rounded-3xl border border-white/10 bg-slate-950/30 p-5">
            <h3 className="text-lg font-semibold text-white">Useful phrase bundles</h3>
            {word.relatedPhrases.length > 0 || word.phrasalVerbs.length > 0 ? (
              <div className="mt-4 flex flex-wrap gap-2">
                {word.relatedPhrases.map((phrase) => (
                  <span
                    key={phrase}
                    className="rounded-full border border-cyan-400/20 bg-cyan-400/10 px-3 py-2 text-sm text-cyan-50"
                  >
                    {phrase}
                  </span>
                ))}
                {word.phrasalVerbs.map((phrase) => (
                  <span
                    key={phrase}
                    className="rounded-full border border-amber-400/20 bg-amber-400/10 px-3 py-2 text-sm text-amber-50"
                  >
                    {phrase}
                  </span>
                ))}
              </div>
            ) : (
              <div className="mt-4 rounded-2xl bg-white/5 p-4 text-sm text-slate-400">
                No phrase or phrasal-verb bundle has been curated for this word yet.
              </div>
            )}
          </div>
        </div>

        <div className="space-y-4 rounded-3xl border border-white/10 bg-slate-950/30 p-5">
          <h3 className="text-lg font-semibold text-white">Real-world usage</h3>
          <p className="text-sm leading-6 text-slate-300">
            See this word in actual media, articles, or community discussion.
          </p>
          {references.slice(0, 2).length > 0 ? (
            <div className="space-y-3">
              {references.slice(0, 2).map((reference) => (
                <div key={reference.id} className="rounded-2xl bg-white/5 p-4">
                  <div className="text-xs uppercase tracking-[0.2em] text-cyan-200">
                    {reference.platform}
                    {reference.timestampLabel ? ` · ${reference.timestampLabel}` : ""}
                  </div>
                  <div className="mt-2 font-medium text-white">{reference.title}</div>
                  <p className="mt-2 text-sm leading-6 text-slate-300">{reference.excerpt}</p>
                </div>
              ))}
            </div>
          ) : (
            <div className="rounded-2xl bg-white/5 p-4 text-sm text-slate-400">
              No curated real-world usage reference has been linked for this word yet.
            </div>
          )}
          <Link
            href={`/word/${word.normalizedLemma}`}
            className="inline-flex rounded-full border border-white/15 px-4 py-2 text-sm text-white transition hover:bg-white/10"
          >
            Open full word page
          </Link>
        </div>
      </div>
    </section>
  );
}
