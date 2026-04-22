import Link from "next/link";

import { WordCatalog } from "@/components/catalog/word-catalog";
import { ListSelector } from "@/components/learn/list-selector";
import { hydrateLearningWords } from "@/lib/content/source-enrichment";
import { getAllLists, getCatalogWordsForList } from "@/lib/content/content-service";

export default async function ListsPage() {
  const lists = getAllLists();
  const featuredCards = await hydrateLearningWords(
    lists.flatMap((list) => getCatalogWordsForList(list.slug, 2)),
  );

  return (
    <div className="mx-auto w-full max-w-6xl px-6 py-12">
      <div className="rounded-[2rem] border border-slate-200 bg-white p-8 shadow-sm">
        <div className="text-xs uppercase tracking-[0.2em] text-cyan-700">
          All learning tracks
        </div>
        <h1 className="mt-3 text-4xl font-semibold text-slate-900">
          Switch between vocabulary lists based on your needs
        </h1>
        <p className="mt-4 max-w-3xl text-lg leading-8 text-slate-600">
          Each list is imported from the NGSL project family and framed as a different
          learning goal, from general fluency to academic or fitness English.
        </p>
      </div>

      <div className="mt-8">
        <ListSelector lists={lists} />
      </div>

      <div className="mt-10 grid gap-6 lg:grid-cols-2">
        {lists.map((list) => (
          <article
            key={list.slug}
            className="rounded-[2rem] border border-slate-200 bg-white p-6 shadow-sm"
          >
            <div className="text-xs uppercase tracking-[0.2em] text-slate-500">
              {list.wordCount} words imported
            </div>
            <h2 className="mt-3 text-2xl font-semibold text-slate-900">{list.title}</h2>
            <p className="mt-3 text-sm leading-7 text-slate-600">{list.moodHook}</p>
            <p className="mt-3 text-sm text-slate-500">
              Open the list practice and word cards to load the strongest currently
              available fixed content for this track.
            </p>
            <div className="mt-5 flex flex-wrap gap-2">
              {getCatalogWordsForList(list.slug, 5).map((word) => (
                <Link
                  key={`${list.slug}-${word.lemma}`}
                  href={`/word/${word.normalizedLemma}`}
                  className="rounded-full border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-800 transition hover:bg-sky-50"
                >
                  {word.lemma}
                </Link>
              ))}
            </div>
            <div className="mt-6 flex gap-3">
              <Link
                href={`/learn/${list.slug}`}
                className="rounded-full bg-cyan-500 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-cyan-600"
              >
                Open practice
              </Link>
              <Link
                href={`/lists/${list.slug}`}
                className="rounded-full border border-cyan-400/60 px-4 py-2 text-sm font-medium text-cyan-800 transition hover:bg-cyan-50"
              >
                Full vocabulary
              </Link>
              <a
                href={list.sourcePageUrl}
                target="_blank"
                rel="noreferrer"
                className="rounded-full border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-800 transition hover:bg-slate-50"
              >
                Source page
              </a>
            </div>
          </article>
        ))}
      </div>

      <div className="mt-10">
        <WordCatalog
          title="Featured word cards"
          description="These cards use the strongest currently available fixed content across the imported lists."
          words={featuredCards}
        />
      </div>
    </div>
  );
}
