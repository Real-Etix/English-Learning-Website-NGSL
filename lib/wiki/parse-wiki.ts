import { readFile, readdir } from "node:fs/promises";
import path from "node:path";

import { louvain } from "./louvain";

/**
 * Server-side reader for the LLM wiki (wiki/pages/*.md).
 *
 * The `[[wiki-links]]` in each page's `## Connections` section are the graph
 * edges — the same structure the LLM maintains doubles as the frontend graph.
 * This is the "frontend contract" defined in wiki/CLAUDE.md.
 */
export type WikiConnection = { type: string; target: string; gloss?: string };

export type WikiPage = {
  lemma: string;
  display: string;
  tier: "core" | "advanced";
  pos: string;
  rank: number | null;
  sfi: number | null;
  chart: string | null;
  region: string | null;
  lists: string[];
  forms: string[];
  status: string;
  sources: string[];
  definition: string;
  usageNote: string | null;
  examples: string[];
  connections: WikiConnection[];
  domains: string[];
};

export type GraphNode = {
  lemma: string;
  display: string;
  tier: "core" | "advanced";
  pos: string;
  rank: number | null;
  chart: string | null;
  degree: number;
};

export type GraphEdge = { source: string; target: string; type: string };

export type ListGraph = {
  slug: string;
  nodes: GraphNode[];
  edges: GraphEdge[];
  pages: Record<string, WikiPage>;
  isolatedCount: number;
};

/** The client only needs nodes + edges to draw the galaxy; page text is fetched on click. */
export type LiteGraph = {
  slug: string;
  nodes: GraphNode[];
  edges: GraphEdge[];
  isolatedCount: number;
  /** Optional themed chart names (chartId → human theme), from scripts/name-charts.ts. */
  chartNames?: Record<string, string>;
};

export function toLiteGraph(g: ListGraph): LiteGraph {
  return { slug: g.slug, nodes: g.nodes, edges: g.edges, isolatedCount: g.isolatedCount };
}

const WIKI_DIR = path.join(process.cwd(), "wiki", "pages");

/** Minimal YAML-subset parse for our fixed frontmatter shape (no dependency). */
function parseFrontmatter(block: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of block.split("\n")) {
    const match = line.match(/^([a-zA-Z]+):\s*(.*)$/);
    if (match) out[match[1]] = match[2].trim();
  }
  return out;
}

function parseYamlList(value: string | undefined): string[] {
  if (!value) return [];
  return value
    .replace(/^\[|\]$/g, "")
    .split(",")
    .map((v) => v.trim())
    .filter(Boolean);
}

/** Parse one `## Connections` bullet: `- type: [[target]] — gloss` or `- domain: tag`. */
function parseConnections(section: string): { connections: WikiConnection[]; domains: string[] } {
  const connections: WikiConnection[] = [];
  const domains: string[] = [];
  for (const raw of section.split("\n")) {
    const line = raw.trim();
    if (!line.startsWith("- ")) continue;
    const body = line.slice(2);
    const typeMatch = body.match(/^([a-z_]+):\s*(.*)$/);
    if (!typeMatch) continue;
    const [, type, rest] = typeMatch;
    if (type === "domain") {
      domains.push(rest.trim());
      continue;
    }
    const linkMatch = rest.match(/\[\[([^\]]+)\]\]/);
    if (!linkMatch) continue;
    const glossMatch = rest.match(/—\s*(.+)$/);
    connections.push({
      type,
      target: linkMatch[1].trim(),
      gloss: glossMatch ? glossMatch[1].trim() : undefined,
    });
  }
  return { connections, domains };
}

function sectionBody(markdown: string, heading: string): string {
  const re = new RegExp(`##\\s+${heading}\\s*\\n([\\s\\S]*?)(?=\\n##\\s|$)`);
  return markdown.match(re)?.[1]?.trim() ?? "";
}

export function parsePage(markdown: string): WikiPage | null {
  const fmMatch = markdown.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!fmMatch) return null;
  const fm = parseFrontmatter(fmMatch[1]);
  const body = fmMatch[2];
  if (!fm.lemma) return null;

  const definition = sectionBody(body, "Definition").replace(/^_|_$/g, "");
  const examples = sectionBody(body, "Examples")
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.startsWith("- "))
    .map((l) => l.slice(2).replace(/\s*_\([^)]*\)_\s*$/, "").trim());
  const { connections, domains } = parseConnections(sectionBody(body, "Connections"));

  return {
    lemma: fm.lemma,
    display: fm.display || fm.lemma,
    tier: fm.tier === "advanced" ? "advanced" : "core",
    pos: fm.pos || "unknown",
    rank: fm.rank ? Number(fm.rank) : null,
    sfi: fm.sfi ? Number(fm.sfi) : null,
    chart: fm.chart || null,
    region: fm.region || null,
    lists: parseYamlList(fm.lists),
    forms: parseYamlList(fm.forms),
    status: fm.status || "seeded",
    sources: parseYamlList(fm.sources),
    definition,
    usageNote: sectionBody(body, "Usage note") || null,
    examples,
    connections,
    domains,
  };
}

/** Read a single page by lemma (for the on-click detail fetch). */
export async function readPage(lemma: string): Promise<WikiPage | null> {
  if (!/^[a-z]+(['-][a-z]+)*$/.test(lemma)) return null; // guard path traversal
  try {
    return parsePage(await readFile(path.join(WIKI_DIR, `${lemma}.md`), "utf8"));
  } catch {
    return null;
  }
}

let _pagesCache: Promise<WikiPage[]> | null = null;

/**
 * Read every wiki page. Cached in-process: with 11k+ files this is expensive, and
 * it's called once per static render (build) and per request (dev). The cache makes
 * repeat calls instant. Restart the dev server after re-seeding to refresh it.
 */
export function readAllPages(): Promise<WikiPage[]> {
  if (!_pagesCache) _pagesCache = readAllPagesUncached();
  return _pagesCache;
}

async function readAllPagesUncached(): Promise<WikiPage[]> {
  const files = (await readdir(WIKI_DIR).catch(() => [] as string[])).filter((f) =>
    f.endsWith(".md"),
  );
  // Read in batches — opening all 10k+ files at once exhausts the OS FD limit (EMFILE).
  const BATCH = 128;
  const pages: WikiPage[] = [];
  for (let i = 0; i < files.length; i += BATCH) {
    const parsed = await Promise.all(
      files
        .slice(i, i + BATCH)
        .map(async (file) => parsePage(await readFile(path.join(WIKI_DIR, file), "utf8"))),
    );
    for (const p of parsed) if (p) pages.push(p);
  }
  return pages;
}

/**
 * Build the graph for one list (or "all"). Only edges whose both ends are pages
 * in the set are kept, deduped by unordered pair + type. Isolated nodes (no
 * in-set edge) are dropped from the graph but counted.
 */
export function buildListGraph(pages: WikiPage[], slug: string): ListGraph {
  const inList = (p: WikiPage) => slug === "all" || p.lists.includes(slug);
  const byLemma = new Map(pages.map((p) => [p.lemma, p]));

  // Pull in two kinds of out-of-list neighbour, to add connectivity without
  // diluting the list: (a) advanced-tier words (the ladder targets, as before);
  // (b) "bridges" — words that TWO OR MORE list words link to, so they knit
  // otherwise-separate stars together. Dead-end leaves linked by just one list
  // word are left out, keeping the galaxy mostly the list's own words.
  const listPages = pages.filter(inList);
  const includedSet = new Set(listPages.map((p) => p.lemma));
  const linkers = new Map<string, Set<string>>(); // external target → distinct list words linking it
  for (const p of listPages) {
    for (const c of p.connections) {
      const target = byLemma.get(c.target);
      if (!target || includedSet.has(c.target)) continue;
      if (target.tier === "advanced") { includedSet.add(c.target); continue; } // ladder target
      (linkers.get(c.target) ?? linkers.set(c.target, new Set()).get(c.target)!).add(p.lemma);
    }
  }
  for (const [target, from] of linkers) if (from.size >= 2) includedSet.add(target);
  return assembleGraph(pages, includedSet, slug);
}

// Meaning edges (WordNet) pull a little harder than the LLM ladder edges, so
// clusters lean toward genuine sense-similarity where the wiki has it.
const EDGE_WEIGHT: Record<string, number> = {
  synonym: 1.6, antonym: 1.3, morphological: 1.2,
  advanced_form: 1, builds_on: 1, intensity: 1, collocation: 0.9,
};
const MIN_CHART = 5; // communities smaller than this get folded into a neighbour (or drift)

/**
 * Cluster a list's own edge graph into charts (Louvain), fold away tiny
 * communities, and name each after its hub word (highest degree, then commonest).
 * Returns lemma → chart name; isolated words are left out (caller uses "drift").
 */
function clusterCharts(
  nodeIds: string[],
  edges: GraphEdge[],
  degree: Map<string, number>,
  rankOf: Map<string, number | null>,
): Map<string, string> {
  const connected = nodeIds.filter((id) => (degree.get(id) ?? 0) > 0);
  const wEdges = edges.map((e) => ({ source: e.source, target: e.target, weight: EDGE_WEIGHT[e.type] ?? 1 }));
  const comm = louvain(connected, wEdges, { resolution: 1 });

  // group members by community
  const groups = new Map<number, string[]>();
  for (const id of connected) {
    const c = comm.get(id)!;
    (groups.get(c) ?? groups.set(c, []).get(c)!).push(id);
  }

  // weight shared between two communities, for folding small ones
  const between = new Map<string, number>();
  const commOf = new Map(connected.map((id) => [id, comm.get(id)!]));
  for (const e of edges) {
    const ca = commOf.get(e.source), cb = commOf.get(e.target);
    if (ca === undefined || cb === undefined || ca === cb) continue;
    const w = EDGE_WEIGHT[e.type] ?? 1;
    const key = ca < cb ? `${ca}|${cb}` : `${cb}|${ca}`;
    between.set(key, (between.get(key) ?? 0) + w);
  }
  const merged = new Map<number, number>(); // community → community it was folded into
  const resolve = (c: number): number => { while (merged.has(c)) c = merged.get(c)!; return c; };
  const frozen = new Set<number>(); // small communities with no cross-community edge (islands)
  // repeatedly fold the smallest under-min community into its strongest neighbour
  for (let guard = 0; guard < connected.length * 2; guard++) {
    // live community sizes after folds so far
    const live = new Map<number, number>();
    for (const id of connected) { const c = resolve(comm.get(id)!); live.set(c, (live.get(c) ?? 0) + 1); }
    let small: number | null = null, smallSize = Infinity;
    for (const [c, s] of live) if (!frozen.has(c) && s < MIN_CHART && s < smallSize) { smallSize = s; small = c; }
    if (small === null) break;
    // best neighbour by shared weight
    let bestN: number | null = null, bestW = -1;
    for (const [key, w] of between) {
      const [x, y] = key.split("|").map(Number);
      const rx = resolve(x), ry = resolve(y);
      if (rx === small && ry !== small && w > bestW) { bestW = w; bestN = ry; }
      else if (ry === small && rx !== small && w > bestW) { bestW = w; bestN = rx; }
    }
    if (bestN === null) { frozen.add(small); continue; } // island: can't merge, skip it
    merged.set(small, bestN);
  }

  // group final communities; a community still below MIN is an unmergeable island —
  // its words become "drift" field stars rather than proliferating tiny charts.
  const finalMembers = new Map<number, string[]>();
  for (const id of connected) {
    const c = resolve(comm.get(id)!);
    (finalMembers.get(c) ?? finalMembers.set(c, []).get(c)!).push(id);
  }
  const chartOf = new Map<string, string>();
  for (const members of finalMembers.values()) {
    if (members.length < MIN_CHART) continue; // → drift
    const hub = members.slice().sort((a, b) => {
      const da = degree.get(a) ?? 0, db = degree.get(b) ?? 0;
      if (db !== da) return db - da;
      const ra = rankOf.get(a) ?? Infinity, rb = rankOf.get(b) ?? Infinity;
      return ra - rb;
    })[0];
    for (const m of members) chartOf.set(m, hub);
  }
  return chartOf;
}

/** Assemble a graph from an explicit set of included lemmas (shared by list + collection views). */
function assembleGraph(pages: WikiPage[], includedSet: Set<string>, slug: string): ListGraph {
  const included = pages.filter((p) => includedSet.has(p.lemma));
  const nodeSet = new Set(included.map((p) => p.lemma));
  const pageMap: Record<string, WikiPage> = {};
  for (const p of included) pageMap[p.lemma] = p;

  const edges: GraphEdge[] = [];
  const seen = new Set<string>();
  const degree = new Map<string, number>();

  for (const page of included) {
    for (const conn of page.connections) {
      if (!nodeSet.has(conn.target)) continue; // link to a non-included page → skip
      const [a, b] = [page.lemma, conn.target].sort();
      const key = `${a}|${b}|${conn.type}`;
      if (seen.has(key)) continue;
      seen.add(key);
      edges.push({ source: page.lemma, target: conn.target, type: conn.type });
      degree.set(page.lemma, (degree.get(page.lemma) ?? 0) + 1);
      degree.set(conn.target, (degree.get(conn.target) ?? 0) + 1);
    }
  }

  // Per-list charts via Louvain over this list's own edges (isolated words drift).
  const rankOf = new Map(included.map((p) => [p.lemma, p.rank]));
  const chartOf = clusterCharts([...nodeSet], edges, degree, rankOf);

  // Show every word — including unconnected ones (degree 0) as dim field-stars —
  // so learners can still find and open them.
  const nodes: GraphNode[] = included.map((p) => ({
    lemma: p.lemma,
    display: p.display,
    tier: p.tier,
    pos: p.pos,
    rank: p.rank,
    chart: chartOf.get(p.lemma) ?? "drift",
    degree: degree.get(p.lemma) ?? 0,
  }));

  return {
    slug,
    nodes,
    edges,
    pages: pageMap,
    isolatedCount: included.filter((p) => (degree.get(p.lemma) ?? 0) === 0).length,
  };
}

/** A learner's collected words rendered as their own galaxy. */
export function buildCollectionGraph(pages: WikiPage[], lemmas: Set<string>): ListGraph {
  return assembleGraph(pages, lemmas, "collection");
}
