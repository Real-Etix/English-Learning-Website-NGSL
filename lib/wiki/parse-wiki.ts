import { readFile, readdir } from "node:fs/promises";
import path from "node:path";

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
  lists: string[];
  forms: string[];
  status: string;
  definition: string;
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
    lists: parseYamlList(fm.lists),
    forms: parseYamlList(fm.forms),
    status: fm.status || "seeded",
    definition,
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

export async function readAllPages(): Promise<WikiPage[]> {
  const files = (await readdir(WIKI_DIR).catch(() => [] as string[])).filter((f) =>
    f.endsWith(".md"),
  );
  // Read in batches — the wiki has 10k+ files, so opening them all at once
  // exhausts the OS file-descriptor limit (EMFILE).
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

  // Advanced pages have no `lists`, so also pull in any advanced word that a
  // list word links to — otherwise the ladders (core → advanced) never show.
  const includedSet = new Set(pages.filter(inList).map((p) => p.lemma));
  for (const p of pages.filter(inList)) {
    for (const c of p.connections) {
      const target = byLemma.get(c.target);
      if (target?.tier === "advanced") includedSet.add(target.lemma);
    }
  }
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

  // Show every word — including unconnected ones (degree 0) as dim field-stars —
  // so learners can still find and open them.
  const nodes: GraphNode[] = included.map((p) => ({
    lemma: p.lemma,
    display: p.display,
    tier: p.tier,
    pos: p.pos,
    rank: p.rank,
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
