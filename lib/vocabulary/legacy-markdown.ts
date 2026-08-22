/**
 * Migration-only parser for the former wiki/pages Markdown format.
 *
 * Runtime code must consume canonical NDJSON records instead. This module stays
 * isolated so the one-time conversion can be reproduced from Git history.
 */
export type LegacyWikiConnection = { type: string; target: string; gloss?: string };
export type LegacyWikiExample = { text: string; sourceIds: string[] };

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
  examples: LegacyWikiExample[];
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

function escapePattern(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Removes the heading and its blank-line separator only. Authored section text is
 * otherwise preserved exactly, aside from CRLF-to-LF normalization.
 */
function sectionBody(markdown: string, heading: string): string {
  const expression = new RegExp(`^##\\s+${escapePattern(heading)}\\s*\\n([\\s\\S]*?)(?:\\n\\n(?=^##\\s)|\\n(?=^##\\s)|(?![\\s\\S]))`, "m");
  const section = markdown.match(expression)?.[1];
  if (section === undefined) return "";
  return section.endsWith("\n") ? section.slice(0, -1) : section;
}

function parseConnections(section: string): { connections: LegacyWikiConnection[]; domains: string[] } {
  const connections: LegacyWikiConnection[] = [];
  const domains: string[] = [];
  for (const raw of section.split("\n")) {
    const bullet = raw.match(/^\s*-\s(.*)$/);
    if (!bullet) continue;
    const typed = bullet[1].match(/^([a-z_]+): ?(.*)$/);
    if (!typed) continue;
    const [, type, value] = typed;
    if (type === "domain") {
      if (value.trim()) domains.push(value.trim());
      continue;
    }
    const linked = value.match(/\[\[([^\]]+)\]\]/);
    if (!linked) continue;
    const delimiter = value.indexOf(" — ");
    const fallbackDelimiter = delimiter < 0 ? value.indexOf("—") : -1;
    const gloss = delimiter >= 0
      ? value.slice(delimiter + " — ".length)
      : fallbackDelimiter >= 0
        ? value.slice(fallbackDelimiter + 1).replace(/^ /, "")
        : undefined;
    connections.push({ type, target: linked[1].trim(), ...(gloss ? { gloss } : {}) });
  }
  return { connections, domains };
}

function parseExamples(section: string): LegacyWikiExample[] {
  const examples: LegacyWikiExample[] = [];
  for (const raw of section.split("\n")) {
    const bullet = raw.match(/^\s*-\s(.*)$/);
    if (!bullet) continue;
    const suffix = /_\(([^)]+)\)_([ \t]*)$/.exec(bullet[1]);
    let text = bullet[1];
    let sourceIds: string[] = [];
    if (suffix?.index !== undefined) {
      text = bullet[1].slice(0, suffix.index);
      if (text.endsWith(" ")) text = text.slice(0, -1);
      sourceIds = suffix[1].split(",").map((value) => value.trim()).filter(Boolean);
    }
    if (text.trim()) examples.push({ text, sourceIds });
  }
  return examples;
}

/** Parses only the fixed legacy page structure; it performs no enrichment or repair. */
export function parseLegacyMarkdownPage(markdown: string): WikiPage | null {
  const normalized = markdown.replace(/\r\n?/g, "\n");
  const match = normalized.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!match) return null;
  const frontmatter = parseFrontmatter(match[1]);
  if (!frontmatter.lemma) return null;
  const body = match[2];
  const { connections, domains } = parseConnections(sectionBody(body, "Connections"));
  const examples = parseExamples(sectionBody(body, "Examples"));

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
