/**
 * Shared markdown-page editors for the wiki scripts.
 * Targeted raw-text edits (no lossy parse/re-serialize round-trip).
 */

export function setFrontmatterField(raw: string, key: string, value: string): string {
  const re = new RegExp(`^(${key}):.*$`, "m");
  return re.test(raw) ? raw.replace(re, `$1: ${value}`) : raw;
}

export function mergeSources(raw: string, add: string): string {
  const m = raw.match(/^sources:\s*\[(.*)\]\s*$/m);
  const current = m ? m[1].split(",").map((s) => s.trim()).filter(Boolean) : [];
  if (!current.includes(add)) current.push(add);
  return setFrontmatterField(raw, "sources", `[${current.join(", ")}]`);
}

/**
 * Insert a connection bullet at the end of the `## Connections` section.
 * Handles pages that have trailing sections (e.g. `## Usage note`) after it.
 */
export function appendConnection(raw: string, line: string): string {
  const connMatch = raw.match(/^##\s+Connections\s*$/m);
  if (!connMatch || connMatch.index === undefined) {
    return `${raw.replace(/\s+$/, "")}\n${line}\n`;
  }
  const afterHeading = connMatch.index + connMatch[0].length;
  const nextHeadingRel = raw.slice(afterHeading).search(/^##\s+/m);
  if (nextHeadingRel === -1) {
    // Connections is the last section — safe to append at end of file.
    return `${raw.replace(/\s+$/, "")}\n${line}\n`;
  }
  const insertAt = afterHeading + nextHeadingRel;
  const before = raw.slice(0, insertAt).replace(/\s+$/, "");
  const rest = raw.slice(insertAt);
  return `${before}\n${line}\n\n${rest}`;
}

export function newAdvancedPage(opts: {
  word: string;
  pos: string;
  definition: string;
  anchor: string;
  gloss: string;
  sources: string[];
  status: "seeded" | "enriched";
  examples?: string[];
}): string {
  const examples =
    opts.examples && opts.examples.length
      ? opts.examples.map((e) => `- ${e}`)
      : ["_No sourced examples yet._"];
  return [
    "---",
    `lemma: ${opts.word}`,
    `display: ${opts.word}`,
    "tier: advanced",
    `pos: ${opts.pos}`,
    `forms: [${opts.word}]`,
    `sources: [${opts.sources.join(", ")}]`,
    `status: ${opts.status}`,
    "---",
    "",
    "## Definition",
    opts.definition,
    "",
    "## Examples",
    examples.join("\n"),
    "",
    "## Connections",
    `- builds_on: [[${opts.anchor}]] — ${opts.gloss}`,
    "",
  ].join("\n");
}
