import Link from "next/link";
import { notFound } from "next/navigation";

import {
  buildCambridgeDictionaryUrl,
  buildDictionaryApiUrl,
} from "@/lib/content/external-links";
import { getListBySlug } from "@/lib/content/content-service";
import type { LearningListSlug } from "@/lib/types";

function statusLabel(status: string) {
  if (status === "manual_override") {
    return "Curated";
  }

  if (status === "source_backed") {
    return "Source-backed";
  }

  return "Fallback";
}

export default async function FullListPage({
  params,
}: {
  params: Promise<{ listSlug: string }>;
}) {
  const { listSlug } = await params;
  const list = getListBySlug(listSlug as LearningListSlug);

  if (!list) {
    notFound();
  }

  return (
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-8 px-6 py-12">
      <section className="rounded-[2rem] border border-slate-200 bg-white p-8 shadow-sm">
        <div className="text-xs uppercase tracking-[0.2em] text-cyan-700">
          Full vocabulary catalog
        </div>
        <h1 className="mt-3 text-4xl font-semibold text-slate-900">{list.title}</h1>
        <p className="mt-4 max-w-4xl text-lg leading-8 text-slate-600">
          Browse the full imported vocabulary range for this list. This page is meant for
          complete coverage and quick lookup, while the learn page keeps a smaller practice
          slice for focus and performance.
        </p>
        <div className="mt-6 flex flex-wrap gap-3">
          <Link
            href={`/learn/${list.slug}`}
            className="rounded-full bg-cyan-500 px-5 py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-cyan-600"
          >
            Back to practice
          </Link>
          <Link
            href="/lists"
            className="rounded-full border border-slate-300 bg-white px-5 py-3 text-sm font-semibold text-slate-800 shadow-sm transition hover:bg-slate-50"
          >
            All lists
          </Link>
        </div>
      </section>

      <section className="rounded-[2rem] border border-slate-200 bg-white p-6 shadow-sm">
        <div className="grid grid-cols-[90px_minmax(0,1.1fr)_130px_120px_minmax(0,1fr)] gap-4 border-b border-slate-200 pb-4 text-xs uppercase tracking-[0.2em] text-slate-500">
          <div>Rank</div>
          <div>Word</div>
          <div>Status</div>
          <div>Part of speech</div>
          <div>Links</div>
        </div>

        <div className="mt-2 divide-y divide-slate-200">
          {list.words.map((word) => (
            <div
              key={`${list.slug}-${word.normalizedLemma}-${word.rank ?? "na"}`}
              className="grid grid-cols-[90px_minmax(0,1.1fr)_130px_120px_minmax(0,1fr)] gap-4 py-4 text-sm"
            >
              <div className="text-slate-500">{word.rank ?? "-"}</div>
              <div>
                <div className="font-semibold text-slate-900">{word.lemma}</div>
                <div className="mt-1 line-clamp-2 text-slate-600">{word.definition}</div>
              </div>
              <div>
                <span className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs text-slate-600">
                  {statusLabel(word.contentStatus)}
                </span>
              </div>
              <div className="text-slate-600">{word.partOfSpeech}</div>
              <div className="flex flex-wrap gap-2">
                <Link
                  href={`/word/${word.normalizedLemma}`}
                  className="rounded-full border border-cyan-400/60 px-3 py-1 text-xs font-medium text-cyan-800 transition hover:bg-cyan-50"
                >
                  Word card
                </Link>
                <a
                  href={buildCambridgeDictionaryUrl(word.lemma)}
                  target="_blank"
                  rel="noreferrer"
                  className="rounded-full border border-slate-200 px-3 py-1 text-xs text-slate-600 transition hover:bg-slate-50"
                >
                  Cambridge
                </a>
                <a
                  href={buildDictionaryApiUrl(word.lemma)}
                  target="_blank"
                  rel="noreferrer"
                  className="rounded-full border border-slate-200 px-3 py-1 text-xs text-slate-600 transition hover:bg-slate-50"
                >
                  Dictionary API
                </a>
              </div>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
