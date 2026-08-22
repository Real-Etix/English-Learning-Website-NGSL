/**
 * Migration-only parser for the former wiki/pages Markdown format.
 *
 * Runtime code must consume canonical NDJSON records instead. This module stays
 * isolated so the one-time conversion can be reproduced from Git history.
 */
export type LegacyWikiConnection = { type: string; target: string; gloss?: string };

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
  connections: LegacyWikiConnection[];
  domains: string[];
};

function parseFrontmatter(block: string): Record<string, string> {
  const fields: Record<string, string> = {};
  for (const line of block.split("\n")) {
    const match = line.match(/^([a-zA-Z]+):\s*(.*)$/);
    if (match) fields[match[1]] = match[2].trim();
  }
  return fields;
}

function parseYamlList(value: string | undefined): string[] {
  if (!value) return [];
  return value
    .replace(/^\[|\]$/g, "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function sectionBody(markdown: string, heading: string): string {
  const expression = new RegExp(`##\\s+${heading}\\s*\\n([\\s\\S]*?)(?=\\n##\\s|$)`);
  return markdown.match(expression)?.[1]?.trim() ?? "";
}

function parseConnections(section: string): { connections: LegacyWikiConnection[]; domains: string[] } {
  const connections: LegacyWikiConnection[] = [];
  const domains: string[] = [];
  for (const raw of section.split("\n")) {
    const line = raw.trim();
    if (!line.startsWith("- ")) continue;
    const typed = line.slice(2).match(/^([a-z_]+):\s*(.*)$/);
    if (!typed) continue;
    const [, type, value] = typed;
    if (type === "domain") {
      if (value.trim()) domains.push(value.trim());
      continue;
    }
    const linked = value.match(/\[\[([^\]]+)\]\]/);
    if (!linked) continue;
    const gloss = value.match(/—\s*(.+)$/)?.[1]?.trim();
    connections.push({ type, target: linked[1].trim(), ...(gloss ? { gloss } : {}) });
  }
  return { connections, domains };
}

/** Parses only the fixed legacy page structure; it performs no enrichment or repair. */
export function parseLegacyMarkdownPage(markdown: string): WikiPage | null {
  const match = markdown.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!match) return null;
  const frontmatter = parseFrontmatter(match[1]);
  if (!frontmatter.lemma) return null;
  const body = match[2];
  const { connections, domains } = parseConnections(sectionBody(body, "Connections"));
  const examples = sectionBody(body, "Examples")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.startsWith("- "))
    .map((line) => line.slice(2).replace(/\s*_\([^)]*\)_\s*$/, "").trim());

  return {
    lemma: frontmatter.lemma,
    display: frontmatter.display || frontmatter.lemma,
    tier: frontmatter.tier === "advanced" ? "advanced" : "core",
    pos: frontmatter.pos || "unknown",
    rank: frontmatter.rank ? Number(frontmatter.rank) : null,
    sfi: frontmatter.sfi ? Number(frontmatter.sfi) : null,
    chart: frontmatter.chart || null,
    region: frontmatter.region || null,
    lists: parseYamlList(frontmatter.lists),
    forms: parseYamlList(frontmatter.forms),
    status: frontmatter.status || "seeded",
    sources: parseYamlList(frontmatter.sources),
    definition: sectionBody(body, "Definition").replace(/^_|_$/g, ""),
    usageNote: sectionBody(body, "Usage note") || null,
    examples,
    connections,
    domains,
  };
}
