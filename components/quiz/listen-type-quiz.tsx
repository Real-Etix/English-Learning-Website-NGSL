"use client";

import Link from "next/link";
import { useMemo, useState } from "react";

import { PronunciationPlayer } from "@/components/audio/pronunciation-player";
import { FeedbackPanel } from "@/components/quiz/feedback-panel";
import { answersMatch } from "@/lib/audio/pronunciation-service";
import { recordAttempt } from "@/lib/progress/progress-service";
import type { LearningWord, PracticeMode, ReferenceItem } from "@/lib/types";

const practiceModes: Array<{
  mode: PracticeMode;
  title: string;
  description: string;
}> = [
  {
    mode: "listen_type",
    title: "Listen and Type",
    description: "Hear the word first, then type what you heard.",
  },
  {
    mode: "meaning_match",
    title: "Meaning Match",
    description: "Choose the best definition for the current target word.",
  },
  {
    mode: "study_card",
    title: "Study Card",
    description: "Review the fixed word card with examples, phrases, and trusted references.",
  },
];

export function ListenTypeQuiz({
  words,
  listSlug,
  initialMode,
  initialPronunciation,
}: {
  words: LearningWord[];
  listSlug: LearningWord["listSlug"];
  initialMode: PracticeMode;
  initialPronunciation: {
    audioUrl: string | null;
    sourceLabel: string;
  };
}) {
  const [mode, setMode] = useState<PracticeMode>(initialMode);
  const [index, setIndex] = useState(0);
  const [answer, setAnswer] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  const [revealed, setRevealed] = useState(false);
  const [references, setReferences] = useState<ReferenceItem[]>([]);
  const [loadingReferences, setLoadingReferences] = useState(false);
  const [meaningStatus, setMeaningStatus] = useState<string | null>(null);
  const [selectedDefinition, setSelectedDefinition] = useState<string | null>(null);

  const currentWord = useMemo(() => words[index % words.length], [index, words]);
  const meaningOptions = useMemo(() => {
    if (!currentWord) {
      return [];
    }

    const distractors = words
      .filter((word) => word.lemma !== currentWord.lemma)
      .filter(
        (word, wordIndex, source) =>
          source.findIndex((candidate) => candidate.definition === word.definition) ===
          wordIndex,
      )
      .slice(index + 1, index + 7)
      .slice(0, 3);
    const options = [currentWord, ...distractors];

    if (options.length < 4) {
      const topUp = words
        .filter((word) => !options.some((option) => option.lemma === word.lemma))
        .slice(0, 4 - options.length);
      options.push(...topUp);
    }

    const rotation = index % options.length;
    return [...options.slice(rotation), ...options.slice(0, rotation)];
  }, [currentWord, index, words]);

  const loadReferences = async (lemma: string) => {
    setLoadingReferences(true);
    setReferences([]);

    try {
      const response = await fetch(`/api/references/${lemma}`);
      const payload = (await response.json()) as { references: ReferenceItem[] };
      setReferences(payload.references);
    } finally {
      setLoadingReferences(false);
    }
  };

  if (!currentWord) {
    return null;
  }

  const resetRound = () => {
    setAnswer("");
    setStatus(null);
    setRevealed(false);
    setMeaningStatus(null);
    setSelectedDefinition(null);
  };

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const correct = answersMatch(answer, currentWord.forms);
    recordAttempt({
      listSlug: currentWord.listSlug,
      lemma: currentWord.lemma,
      correct,
    });

    if (correct) {
      setStatus("Correct. Open the feedback panel to reinforce the word in context.");
      setRevealed(true);
      await loadReferences(currentWord.normalizedLemma);
      return;
    }

    setStatus("Not quite. Listen again and try one more time.");
  };

  const moveNext = () => {
    const nextIndex = (index + 1) % words.length;
    setIndex(nextIndex);
    resetRound();

    if (mode === "study_card") {
      void loadReferences(words[nextIndex].normalizedLemma);
    }
  };

  const handleMeaningChoice = (lemma: string) => {
    if (selectedDefinition) {
      return;
    }

    const correct = lemma === currentWord.lemma;
    setSelectedDefinition(lemma);
    setMeaningStatus(
      correct
        ? "Correct. You matched the meaning to the target word."
        : `Not quite. The correct answer is "${currentWord.lemma}".`,
    );
    recordAttempt({
      listSlug: currentWord.listSlug,
      lemma: currentWord.lemma,
      correct,
    });
  };

  const activeMode = practiceModes.find((item) => item.mode === mode);

  return (
    <div className="space-y-6">
      <section
        id="practice-studio"
        className="rounded-[2rem] border border-white/10 bg-white/5 p-6"
      >
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <div className="text-xs uppercase tracking-[0.2em] text-slate-400">
              Practice studio
            </div>
            <h2 className="mt-2 text-3xl font-semibold text-white">
              {activeMode?.title}
            </h2>
            <p className="mt-3 max-w-2xl text-sm leading-7 text-slate-300">
              {activeMode?.description}
            </p>
          </div>
          <div className="rounded-3xl border border-white/10 bg-slate-950/40 px-4 py-3 text-sm text-slate-300">
            Card {index + 1} / {words.length}
          </div>
        </div>

        <div className="mt-6 space-y-5">
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
            {practiceModes.map((item) => (
              <Link
                key={item.mode}
                href={`/learn/${listSlug}?mode=${item.mode}#practice-studio`}
                onClick={() => {
                  setMode(item.mode);
                  resetRound();

                  if (item.mode === "study_card") {
                    void loadReferences(currentWord.normalizedLemma);
                  }
                }}
                className={`rounded-3xl border px-4 py-4 text-left transition ${
                  item.mode === mode
                    ? "border-cyan-400/70 bg-cyan-400/10 text-white"
                    : "border-white/10 bg-slate-950/35 text-slate-300 hover:border-white/20 hover:bg-white/10"
                }`}
              >
                <div className="text-sm font-semibold">{item.title}</div>
                <p className="mt-2 text-sm leading-6 text-inherit/80">{item.description}</p>
              </Link>
            ))}
          </div>

          {mode === "listen_type" ? (
            <>
              <PronunciationPlayer
                key={currentWord.lemma}
                word={currentWord.lemma}
                initialAudioUrl={index === 0 ? initialPronunciation.audioUrl : null}
                initialSourceLabel={
                  index === 0
                    ? initialPronunciation.sourceLabel
                    : "Checking free pronunciation audio..."
                }
              />
              <form onSubmit={handleSubmit} className="flex flex-col gap-4 lg:flex-row">
                <input
                  value={answer}
                  onChange={(event) => setAnswer(event.target.value)}
                  placeholder="Type the word you hear"
                  className="flex-1 rounded-full border border-white/10 bg-slate-950/50 px-5 py-4 text-white outline-none transition focus:border-cyan-300/60"
                />
                <button
                  type="submit"
                  className="rounded-full bg-cyan-300 px-6 py-4 font-semibold text-slate-950 transition hover:bg-cyan-200"
                >
                  Check answer
                </button>
                <button
                  type="button"
                  onClick={moveNext}
                  className="rounded-full border border-white/15 px-6 py-4 font-semibold text-white transition hover:bg-white/10"
                >
                  Next word
                </button>
              </form>

              <div className="rounded-2xl bg-slate-950/30 px-4 py-3 text-sm text-slate-300">
                Tip: replay the audio and focus on the full word shape before typing.
              </div>

              {status ? (
                <div
                  className={`rounded-2xl px-4 py-3 text-sm ${
                    revealed
                      ? "bg-emerald-400/10 text-emerald-100"
                      : "bg-amber-400/10 text-amber-100"
                  }`}
                >
                  {status}
                </div>
              ) : null}
            </>
          ) : null}

          {mode === "meaning_match" ? (
            <section className="space-y-4 rounded-3xl border border-white/10 bg-slate-950/30 p-5">
              <div className="text-sm text-slate-300">
                Choose the definition that best matches <span className="font-semibold text-white">{currentWord.lemma}</span>.
              </div>
              <div className="grid gap-3">
                {meaningOptions.map((option) => {
                  const isSelected = selectedDefinition === option.lemma;
                  const isCorrect = option.lemma === currentWord.lemma;

                  return (
                    <button
                      key={option.lemma}
                      type="button"
                      onClick={() => handleMeaningChoice(option.lemma)}
                      disabled={Boolean(selectedDefinition)}
                      className={`rounded-3xl border px-4 py-4 text-left transition ${
                        isSelected && isCorrect
                          ? "border-emerald-400/60 bg-emerald-400/10 text-emerald-50"
                          : isSelected
                            ? "border-rose-400/50 bg-rose-400/10 text-rose-50"
                            : "border-white/10 bg-white/5 text-slate-200 hover:bg-white/10"
                      }`}
                    >
                      {option.definition}
                    </button>
                  );
                })}
              </div>
              {meaningStatus ? (
                <div className="rounded-2xl bg-cyan-400/10 px-4 py-3 text-sm text-cyan-100">
                  {meaningStatus}
                </div>
              ) : null}
              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={moveNext}
                  className="rounded-full border border-white/15 px-5 py-3 text-sm font-semibold text-white transition hover:bg-white/10"
                >
                  Next word
                </button>
                <Link
                  href={`/word/${currentWord.normalizedLemma}`}
                  className="rounded-full border border-cyan-400/30 px-5 py-3 text-sm font-semibold text-cyan-100 transition hover:bg-cyan-400/10"
                >
                  Open word page
                </Link>
              </div>
            </section>
          ) : null}

          {mode === "study_card" ? (
            <section className="space-y-4 rounded-3xl border border-white/10 bg-slate-950/30 p-5">
              <PronunciationPlayer
                key={currentWord.lemma}
                word={currentWord.lemma}
                initialAudioUrl={index === 0 ? initialPronunciation.audioUrl : null}
                initialSourceLabel={
                  index === 0
                    ? initialPronunciation.sourceLabel
                    : "Checking free pronunciation audio..."
                }
              />
              <FeedbackPanel
                word={currentWord}
                references={loadingReferences ? [] : references}
                title="Study card"
                subtitle="Review the fixed word card content for this vocabulary item."
              />
              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={moveNext}
                  className="rounded-full border border-white/15 px-5 py-3 text-sm font-semibold text-white transition hover:bg-white/10"
                >
                  Next word
                </button>
                <Link
                  href={`/word/${currentWord.normalizedLemma}`}
                  className="rounded-full border border-cyan-400/30 px-5 py-3 text-sm font-semibold text-cyan-100 transition hover:bg-cyan-400/10"
                >
                  Open word page
                </Link>
              </div>
            </section>
          ) : null}
        </div>
      </section>

      {mode === "listen_type" && revealed ? (
        <>
          <FeedbackPanel
            word={currentWord}
            references={loadingReferences ? [] : references}
          />
        </>
      ) : null}
    </div>
  );
}
