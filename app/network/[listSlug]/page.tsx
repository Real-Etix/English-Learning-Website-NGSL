import Link from "next/link";
import { notFound } from "next/navigation";

import { GalaxyClient } from "@/components/network/galaxy-client";
import { getListBySlug } from "@/lib/content/content-service";
import { buildListGraph, readAllPages, toLiteGraph } from "@/lib/wiki/parse-wiki";
import type { LearningListSlug } from "@/lib/types";

// Pre-render each list galaxy at build time (reads the 11k wiki files on the
// build machine, not per request) so the deployed pages are static and fast.
export function generateStaticParams() {
  return ["ngsl", "toeic", "business", "academic", "fitness", "all"].map((listSlug) => ({
    listSlug,
  }));
}

export default async function NetworkPage({
  params,
}: {
  params: Promise<{ listSlug: string }>;
}) {
  const { listSlug } = await params;
  const list = listSlug === "all" ? null : getListBySlug(listSlug as LearningListSlug);
  if (listSlug !== "all" && !list) {
    notFound();
  }

  const pages = await readAllPages();
  const graph = toLiteGraph(buildListGraph(pages, listSlug));
  const title = list ? list.title : "All words";

  return (
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-8 px-6 py-12">
      <section className="overflow-hidden rounded-[2rem] border border-white/10 bg-gradient-to-br from-[#0a0f24] via-[#0b1027] to-[#120a2a] p-8 text-slate-100 shadow-sm">
        <div className="text-xs uppercase tracking-[0.2em] text-sky-300">
          Vocabulary galaxy
        </div>
        <h1 className="mt-3 text-4xl font-semibold">{title}</h1>
        <p className="mt-4 max-w-3xl text-lg leading-8 text-slate-300">
          Every word is a star; every line is a real relationship pulled from the wiki.
          Orbit the galaxy, then click a star to open its full entry — pronunciation,
          definitions, and the ladder toward more advanced vocabulary.
        </p>
        <div className="mt-6 flex flex-wrap gap-3">
          {["ngsl", "toeic", "business", "academic", "fitness", "all"].map((slug) => (
            <Link
              key={slug}
              href={`/network/${slug}`}
              className={`rounded-full px-4 py-2 text-sm font-semibold transition ${
                slug === listSlug
                  ? "bg-sky-400 text-slate-900 shadow-sm"
                  : "border border-white/15 bg-white/5 text-slate-200 hover:bg-white/10"
              }`}
            >
              {slug === "all" ? "All" : slug.toUpperCase()}
            </Link>
          ))}
        </div>
      </section>

      {graph.nodes.length === 0 ? (
        <section className="rounded-[2rem] border border-dashed border-slate-300 bg-white p-12 text-center text-slate-500">
          No connected words seeded for this list yet. Run{" "}
          <code className="rounded bg-slate-100 px-1.5 py-0.5 text-slate-700">
            tsx scripts/seed-wiki-pages.ts --list={listSlug}
          </code>{" "}
          to populate it.
        </section>
      ) : (
        <GalaxyClient graph={graph} />
      )}
    </div>
  );
}
