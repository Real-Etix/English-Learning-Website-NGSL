import Link from "next/link";

import { ListSelector } from "@/components/learn/list-selector";
import { MoodSelector } from "@/components/learn/mood-selector";
import { getFeaturedLists } from "@/lib/content/content-service";

export default function Home() {
  const lists = getFeaturedLists();

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-14 px-6 py-12">
      <section className="grid gap-8 lg:grid-cols-[1.25fr_0.75fr] lg:items-center">
        <div className="space-y-7">
          <div className="inline-flex rounded-full border border-cyan-400/50 bg-cyan-100 px-4 py-2 text-sm text-cyan-900">
            Switch lists by mood, need, and English goal
          </div>
          <div className="space-y-5">
            <h1 className="max-w-3xl text-5xl font-semibold tracking-tight text-slate-900 sm:text-6xl">
              Learn NGSL-based vocabulary through listening, typing, guided practice, and real usage.
            </h1>
            <p className="max-w-2xl text-lg leading-8 text-slate-600">
              Choose the list that matches your mood: TOEIC, Business, Academic,
              Fitness, or the core NGSL. Listen to a word, type it, unlock example
              sentences, and see the phrase inside authentic media and conversation.
            </p>
          </div>
          <div className="flex flex-wrap gap-3">
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
              Start with NGSL
            </Link>
          </div>
        </div>

        <div className="rounded-[2rem] border border-slate-200 bg-white p-6 shadow-sm">
          <div className="text-xs uppercase tracking-[0.2em] text-slate-500">
            What the app supports
          </div>
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            {[
              "Listen-and-type pronunciation drills",
              "Progress counts and streak-friendly study",
              "Local sentence and conversation practice builder",
              "Curated usage from videos, blogs, forums, and social posts",
            ].map((item) => (
              <div key={item} className="rounded-3xl border border-slate-100 bg-sky-50/80 p-4 text-sm text-slate-700">
                {item}
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="space-y-6">
        <div className="space-y-2">
          <div className="text-xs uppercase tracking-[0.2em] text-cyan-700">
            Learn by mood
          </div>
          <h2 className="text-3xl font-semibold text-slate-900">Pick how you feel today</h2>
        </div>
        <MoodSelector />
      </section>

      <section className="space-y-6">
        <div className="flex items-end justify-between gap-4">
          <div>
            <div className="text-xs uppercase tracking-[0.2em] text-slate-500">
              List switcher
            </div>
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
