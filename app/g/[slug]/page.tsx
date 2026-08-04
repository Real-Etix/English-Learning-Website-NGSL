import { cookies } from "next/headers";
import Link from "next/link";
import { notFound } from "next/navigation";

import { GalaxyClient } from "@/components/network/galaxy-client";
import { getMySummary, getSpaceBySlug } from "@/lib/collection/service";
import { buildCollectionGraph, readAllPages, toLiteGraph } from "@/lib/wiki/parse-wiki";

export const dynamic = "force-dynamic"; // reads a public space + the visitor's cookie

export default async function VisitSpacePage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const space = await getSpaceBySlug(slug);
  if (!space) notFound();

  const token = (await cookies()).get("ownerToken")?.value;
  const me = await getMySummary(token);
  const mine = new Set(me?.lemmas ?? []);
  const undiscovered = space.lemmas.filter((l) => !mine.has(l)).length;

  const pages = await readAllPages();
  const graph = toLiteGraph(buildCollectionGraph(pages, new Set(space.lemmas)));
  const name = space.displayName ?? slug;

  return (
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-8 px-6 py-12">
      <section className="overflow-hidden rounded-[2rem] border border-white/10 bg-gradient-to-br from-[#160a24] via-[#0b1027] to-[#0a0f24] p-8 text-slate-100 shadow-sm">
        <div className="text-xs uppercase tracking-[0.2em] text-violet-300">Exploring a space</div>
        <h1 className="mt-3 text-4xl font-semibold">{name}’s universe</h1>
        <p className="mt-4 max-w-3xl text-lg leading-8 text-slate-300">
          {space.wordCount} words · Level {space.level}. You&apos;ve discovered{" "}
          <span className="font-semibold text-sky-200">
            {space.wordCount - undiscovered}/{space.wordCount}
          </span>{" "}
          of them. Open a star and <span className="text-violet-200">collect</span> the words you
          don&apos;t have yet to earn XP.
        </p>
        <div className="mt-6 flex flex-wrap gap-3">
          <Link
            href="/network/ngsl"
            className="rounded-full border border-white/15 bg-white/5 px-4 py-2 text-sm font-semibold text-slate-200 transition hover:bg-white/10"
          >
            ← Back to the full galaxy
          </Link>
          <Link
            href="/space"
            className="rounded-full bg-sky-400 px-4 py-2 text-sm font-semibold text-slate-900 transition hover:bg-sky-300"
          >
            Your Space
          </Link>
        </div>
      </section>

      <GalaxyClient graph={graph} discoveryMode />
    </div>
  );
}
