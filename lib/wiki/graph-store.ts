import { readFile } from "node:fs/promises";
import path from "node:path";

import type { GraphNode, LiteGraph } from "../vocabulary/graph";

/**
 * Loads pre-generated per-list graph JSON (from scripts/build-graph-data.ts).
 * Graph assets are a build artifact: serving a request must never scan the
 * canonical corpus as a fallback.
 */
const DIR = path.join(process.cwd(), "data", "generated", "graphs");
const cache = new Map<string, Promise<LiteGraph>>();

export function loadListGraph(slug: string): Promise<LiteGraph> {
  let cached = cache.get(slug);
  if (!cached) {
    cached = (async () => {
      try {
        return JSON.parse(await readFile(path.join(DIR, `${slug}.json`), "utf8")) as LiteGraph;
      } catch (error) {
        throw new Error(
          `Generated graph for "${slug}" is unavailable. Run npm run build:graphs during the build before serving this deployment.`,
          { cause: error },
        );
      }
    })();
    cache.set(slug, cached);
  }
  return cached;
}

/** A learner's collected words as a subgraph of the full ("all") graph — no file reads. */
export async function loadCollectionGraph(lemmas: Set<string>): Promise<LiteGraph> {
  const all = await loadListGraph("all");
  const nodesIn = all.nodes.filter((n) => lemmas.has(n.lemma));
  const edges = all.edges.filter((e) => lemmas.has(e.source) && lemmas.has(e.target));

  const degree = new Map<string, number>();
  for (const e of edges) {
    degree.set(e.source, (degree.get(e.source) ?? 0) + 1);
    degree.set(e.target, (degree.get(e.target) ?? 0) + 1);
  }
  const nodes: GraphNode[] = nodesIn.map((n) => ({ ...n, degree: degree.get(n.lemma) ?? 0 }));

  return {
    slug: "collection",
    nodes,
    edges,
    isolatedCount: nodes.filter((n) => n.degree === 0).length,
  };
}
