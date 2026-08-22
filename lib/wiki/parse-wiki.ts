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
