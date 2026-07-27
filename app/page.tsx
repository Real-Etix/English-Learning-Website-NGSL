import Link from "next/link";

import { GalaxyClient } from "@/components/network/galaxy-client";
import { ListSelector } from "@/components/learn/list-selector";
import { MoodSelector } from "@/components/learn/mood-selector";
import { getFeaturedLists } from "@/lib/content/content-service";
import { buildListGraph, readAllPages, toLiteGraph } from "@/lib/wiki/parse-wiki";

export default async function Home() {
  const lists = getFeaturedLists();
  const pages = await readAllPages();
  const graph = toLiteGraph(buildListGraph(pages, "ngsl"));

  return (
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-12 px-6 py-12">
      {/* Galaxy front and center */}
      <section className="overflow-hidden rounded-[2rem] border border-white/10 bg-gradient-to-br from-[#0a0f24] via-[#0b1027] to-[#120a2a] p-8 text-slate-100 shadow-sm">
        <div className="text-xs uppercase tracking-[0.2em] text-sky-300">Vocabulary galaxy</div>
        <h1 className="mt-3 max-w-3xl text-4xl font-semibold tracking-tight sm:text-5xl">
          Explore English as a universe of words
        </h1>
        <p className="mt-4 max-w-3xl text-lg leading-8 text-slate-300">
          Every word is a star; every line is a real relationship. Orbit the NGSL core, click a
          star for its full entry — pronunciation, meaning, and the ladder toward more advanced
          vocabulary — or jump to another galaxy.
        </p>
        <div className="mt-6 flex flex-wrap gap-3">
          {["ngsl", "toeic", "business", "academic", "fitness", "all"].map((slug) => (
            <Link
              key={slug}
              href={`/network/${slug}`}
              className={`rounded-full px-4 py-2 text-sm font-semibold transition ${
                slug === "ngsl"
                  ? "bg-sky-400 text-slate-900 shadow-sm"
                  : "border border-white/15 bg-white/5 text-slate-200 hover:bg-white/10"
              }`}
            >
              {slug === "all" ? "All" : slug.toUpperCase()}
            </Link>
          ))}
        </div>
      </section>

      <GalaxyClient graph={graph} />

      <section className="flex flex-wrap items-center gap-3">
        <Link
          href="/lists"
          className="rounded-full bg-cyan-500 px-6 py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-cyan-600"
        >
          Browse all lists
        </Link>
        <Link
          href="/learn/ngsl"
          className="rounded-full border border-slate-300 bg-white px-6 py-3 text-sm font-semibold text-slate-800 shadow-sm transition hover:bg-slate-50"
        >
          Start practicing NGSL
        </Link>
      </section>

      <section className="space-y-6">
        <div className="space-y-2">
          <div className="text-xs uppercase tracking-[0.2em] text-cyan-700">Learn by mood</div>
          <h2 className="text-3xl font-semibold text-slate-900">Pick how you feel today</h2>
        </div>
        <MoodSelector />
      </section>

      <section className="space-y-6">
        <div className="flex items-end justify-between gap-4">
          <div>
            <div className="text-xs uppercase tracking-[0.2em] text-slate-500">List switcher</div>
            <h2 className="mt-2 text-3xl font-semibold text-slate-900">
              Move between goal-specific word lists
            </h2>
          </div>
          <Link href="/dashboard" className="text-sm font-medium text-cyan-700 hover:text-cyan-900">
            View dashboard
          </Link>
        </div>
        <ListSelector lists={lists} />
      </section>

      <section className="grid gap-6 lg:grid-cols-2">
        {lists.map((list) => (
          <article
            key={list.slug}
            className="rounded-[2rem] border border-slate-200 bg-white p-6 shadow-sm"
          >
            <div className="text-xs uppercase tracking-[0.2em] text-slate-500">
              {list.shortLabel}
            </div>
            <h3 className="mt-3 text-2xl font-semibold text-slate-900">{list.title}</h3>
            <p className="mt-3 text-sm leading-7 text-slate-600">{list.description}</p>
            <div className="mt-5 flex flex-wrap gap-2">
              {list.featuredWords.map((word) => (
                <Link
                  key={`${list.slug}-${word.lemma}`}
                  href={`/word/${word.normalizedLemma}`}
                  className="rounded-full border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-800 transition hover:bg-sky-50"
                >
                  {word.lemma}
                </Link>
              ))}
            </div>
            <Link
              href={`/learn/${list.slug}`}
              className="mt-6 inline-flex rounded-full border border-cyan-400/60 px-4 py-2 text-sm font-medium text-cyan-800 transition hover:bg-cyan-50"
            >
              Practice this list
            </Link>
          </article>
        ))}
      </section>
    </div>
  );
}
