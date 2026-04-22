"use client";

import { useState } from "react";

import { buildPracticePack } from "@/lib/audio/pronunciation-service";
import type { AiGenerationResult, LearningWord } from "@/lib/types";

const initialState: AiGenerationResult | null = null;

export function GeneratePanel({
  word,
  listTitle,
}: {
  word: LearningWord;
  listTitle: string;
}) {
  const [topic, setTopic] = useState(word.relatedPhrases[0] ?? "daily life");
  const [level, setLevel] = useState("B1");
  const [result, setResult] = useState<AiGenerationResult | null>(initialState);

  const handleGenerate = () => {
    setResult(buildPracticePack(word, topic, level));
  };

  return (
    <section className="rounded-[2rem] border border-violet-400/20 bg-violet-400/10 p-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <div className="text-xs uppercase tracking-[0.2em] text-violet-200">
            Fixed practice pack
          </div>
          <h2 className="mt-2 text-2xl font-semibold text-white">
            Build a local practice pack for {word.lemma}
          </h2>
          <p className="mt-3 max-w-2xl text-sm leading-6 text-violet-100/85">
            This turns the trusted fixed content from {listTitle} into a reusable study
            pack. No paid AI or token-based API is involved.
          </p>
        </div>
        <div className="flex flex-wrap gap-3">
          <input
            value={topic}
            onChange={(event) => setTopic(event.target.value)}
            className="rounded-full border border-white/10 bg-slate-950/50 px-4 py-2 text-sm text-white outline-none"
            placeholder="Topic"
          />
          <select
            value={level}
            onChange={(event) => setLevel(event.target.value)}
            className="rounded-full border border-white/10 bg-slate-950/50 px-4 py-2 text-sm text-white outline-none"
          >
            <option value="A2">A2</option>
            <option value="B1">B1</option>
            <option value="B2">B2</option>
            <option value="C1">C1</option>
          </select>
          <button
            type="button"
            onClick={handleGenerate}
            className="rounded-full bg-violet-300 px-4 py-2 text-sm font-semibold text-slate-950 transition hover:bg-violet-200 disabled:cursor-not-allowed disabled:opacity-60"
          >
            Build fixed pack
          </button>
        </div>
      </div>

      {result ? (
        <div className="mt-6 grid gap-4 lg:grid-cols-3">
          <div className="rounded-3xl bg-slate-950/35 p-5">
            <h3 className="text-lg font-semibold text-white">Sentences</h3>
            {result.sentences.length > 0 ? (
              <ul className="mt-3 space-y-3 text-sm leading-6 text-slate-200">
                {result.sentences.map((sentence) => (
                  <li key={sentence}>{sentence}</li>
                ))}
              </ul>
            ) : (
              <p className="mt-3 text-sm leading-6 text-slate-400">
                No fixed example sentences have been generated for this word yet.
              </p>
            )}
          </div>
          <div className="rounded-3xl bg-slate-950/35 p-5">
            <h3 className="text-lg font-semibold text-white">Paragraph</h3>
            <p className="mt-3 text-sm leading-7 text-slate-200">{result.paragraph}</p>
          </div>
          <div className="rounded-3xl bg-slate-950/35 p-5">
            <h3 className="text-lg font-semibold text-white">Conversation</h3>
            <div className="mt-3 space-y-3 text-sm leading-6 text-slate-200">
              {result.conversation.map((turn) => (
                <p key={turn}>{turn}</p>
              ))}
            </div>
            <p className="mt-4 text-sm text-violet-100/80">{result.usageTip}</p>
            <p className="mt-3 text-xs uppercase tracking-[0.2em] text-violet-200">
              Template-based practice
            </p>
          </div>
        </div>
      ) : null}
    </section>
  );
}
