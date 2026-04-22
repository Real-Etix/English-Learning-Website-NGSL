import { notFound } from "next/navigation";

import { GeneratePanel } from "@/components/ai/generate-panel";
import { PronunciationPlayer } from "@/components/audio/pronunciation-player";
import { SourceCreditBadges } from "@/components/content/source-credit-badges";
import { ReferenceCard } from "@/components/references/reference-card";
import { fetchFreePronunciationAudio } from "@/lib/audio/free-pronunciation";
import { hydrateLearningWord } from "@/lib/content/source-enrichment";
import { getWordByLemma } from "@/lib/content/content-service";
import { getReferencesForLemma } from "@/lib/references/reference-service";

export default async function WordPage({
  params,
}: {
  params: Promise<{ lemma: string }>;
}) {
  const { lemma } = await params;
  const match = getWordByLemma(lemma);

  if (!match) {
    notFound();
  }

  const hydratedWord = await hydrateLearningWord(match.word);
  const pronunciation = await fetchFreePronunciationAudio(hydratedWord.lemma);
  const references = getReferencesForLemma(hydratedWord.normalizedLemma);

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-8 px-6 py-12">
      <section className="grid gap-6 rounded-[2rem] border border-white/10 bg-white/5 p-8 lg:grid-cols-[1.2fr_0.8fr]">
        <div>
          <div className="text-xs uppercase tracking-[0.2em] text-cyan-200">
            {match.list.title}
          </div>
          <h1 className="mt-3 text-5xl font-semibold text-white">{hydratedWord.lemma}</h1>
          <p className="mt-4 text-lg leading-8 text-slate-300">{hydratedWord.definition}</p>
          <div className="mt-4">
            <SourceCreditBadges credits={hydratedWord.sourceCredits} />
          </div>
          {hydratedWord.relatedPhrases.length > 0 || hydratedWord.phrasalVerbs.length > 0 ? (
            <div className="mt-5 flex flex-wrap gap-2">
              {hydratedWord.relatedPhrases.map((phrase) => (
                <span
                  key={phrase}
                  className="rounded-full border border-cyan-400/20 bg-cyan-400/10 px-3 py-2 text-sm text-cyan-50"
                >
                  {phrase}
                </span>
              ))}
              {hydratedWord.phrasalVerbs.map((phrase) => (
                <span
                  key={phrase}
                  className="rounded-full border border-amber-400/20 bg-amber-400/10 px-3 py-2 text-sm text-amber-50"
                >
                  {phrase}
                </span>
              ))}
            </div>
          ) : null}
        </div>
        <div className="rounded-[2rem] border border-white/10 bg-slate-950/40 p-6">
          <div className="text-xs uppercase tracking-[0.2em] text-slate-400">
            Pronunciation and spelling
          </div>
          <div className="mt-3 text-sm leading-7 text-slate-300">
            Replay the word, then spell it aloud or type it in the learning view.
          </div>
          <div className="mt-5">
            <PronunciationPlayer
              key={hydratedWord.lemma}
              word={hydratedWord.lemma}
              initialAudioUrl={pronunciation.audioUrl}
              initialSourceLabel={pronunciation.sourceLabel}
            />
          </div>
          <div className="mt-5 text-sm text-slate-400">
            Imported forms: {hydratedWord.forms.slice(0, 6).join(", ")}
          </div>
        </div>
      </section>

      <section className="grid gap-6 lg:grid-cols-[0.9fr_1.1fr]">
        <div className="rounded-[2rem] border border-white/10 bg-white/5 p-6">
          <h2 className="text-2xl font-semibold text-white">Example sentences</h2>
          {hydratedWord.exampleSentences.length > 0 ? (
            <div className="mt-5 space-y-4">
              {hydratedWord.exampleSentences.map((sentence) => (
                <div key={sentence.id} className="rounded-3xl bg-slate-950/40 p-4">
                  <p className="text-sm leading-7 text-slate-100">{sentence.text}</p>
                  <p className="mt-2 text-sm text-slate-400">{sentence.explanation}</p>
                </div>
              ))}
            </div>
          ) : (
            <div className="mt-5 rounded-3xl bg-slate-950/40 p-5 text-sm text-slate-400">
              No trusted fixed example sentence has been generated for this word yet.
            </div>
          )}
        </div>

        <div className="rounded-[2rem] border border-white/10 bg-white/5 p-6">
          <h2 className="text-2xl font-semibold text-white">Phrases and real-world usage</h2>
          <p className="mt-4 text-sm leading-7 text-slate-300">
            {hydratedWord.conversationPrompt}
          </p>
          {hydratedWord.relatedPhrases.length > 0 || hydratedWord.phrasalVerbs.length > 0 ? (
            <div className="mt-5 flex flex-wrap gap-2">
              {hydratedWord.relatedPhrases.map((phrase) => (
                <span
                  key={phrase}
                  className="rounded-full border border-cyan-400/20 bg-cyan-400/10 px-3 py-2 text-sm text-cyan-50"
                >
                  {phrase}
                </span>
              ))}
              {hydratedWord.phrasalVerbs.map((phrase) => (
                <span
                  key={phrase}
                  className="rounded-full border border-amber-400/20 bg-amber-400/10 px-3 py-2 text-sm text-amber-50"
                >
                  {phrase}
                </span>
              ))}
            </div>
          ) : (
            <div className="mt-5 rounded-3xl bg-slate-950/40 p-5 text-sm text-slate-400">
              No phrase or phrasal-verb bundle has been generated for this word yet.
            </div>
          )}
          <div className="mt-5 grid gap-4">
            {references.length > 0 ? (
              references.map((reference) => (
                <ReferenceCard key={reference.id} reference={reference} />
              ))
            ) : (
              <div className="rounded-3xl bg-slate-950/40 p-5 text-sm text-slate-300">
                Curated real-world references are not available for this word yet.
              </div>
            )}
          </div>
        </div>
      </section>

      <GeneratePanel word={hydratedWord} listTitle={match.list.title} />
    </div>
  );
}
