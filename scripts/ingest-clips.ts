/**
 * Drain captured clips into the raw archive and report words not yet represented
 * by canonical vocabulary. Vocabulary v2 owns advanced-record creation, so this
 * migration deliberately never writes a new vocabulary record.
 */
import { appendFile, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import { functionWordDefs } from "../data/function-words";
import { openNdjsonRepository } from "../lib/vocabulary/ndjson-repository";

const ROOT = process.cwd();
const RAW_DIR = path.join(ROOT, "wiki", "raw");
const INBOX = path.join(RAW_DIR, "inbox.jsonl");
const UNRESOLVED = path.join(RAW_DIR, "unresolved.json");

const STOPWORDS = new Set([
  ...Object.keys(functionWordDefs),
  "is", "are", "was", "were", "been", "being", "am",
  "has", "had", "does", "did", "done", "will", "would", "can", "could",
  "should", "may", "might", "must", "shall", "there", "here", "about",
  "into", "over", "under", "again", "once", "such", "only", "own", "same",
  "these", "those", "them", "him", "our", "out", "off", "all", "each",
]);

type Clip = { text: string; url: string; title: string; clippedAt: string };
type UnresolvedWord = { word: string; reason: string };

function parseArgs() {
  const parsed = { limit: 40, dryRun: false };
  for (const argument of process.argv.slice(2)) {
    if (argument.startsWith("--limit=")) parsed.limit = Number(argument.slice("--limit=".length)) || parsed.limit;
    else if (argument === "--dry-run") parsed.dryRun = true;
  }
  return parsed;
}

function tokenize(text: string): string[] {
  return (text.toLowerCase().match(/[a-z][a-z'-]{2,}/g) ?? []).map((token) => token.replace(/^['-]+|['-]+$/g, ""));
}

function slugify(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "clip";
}

async function loadClips(): Promise<Clip[]> {
  try {
    return (await readFile(INBOX, "utf8"))
      .split("\n")
      .filter((line) => line.trim())
      .map((line) => JSON.parse(line) as Clip);
  } catch {
    return [];
  }
}

async function canonicalLemmas(): Promise<Set<string>> {
  const lemmas = new Set<string>();
  for await (const record of openNdjsonRepository().all()) lemmas.add(record.lemma);
  return lemmas;
}

async function reportUnresolved(entries: UnresolvedWord[]): Promise<void> {
  if (entries.length === 0) return;
  await mkdir(RAW_DIR, { recursive: true });
  let existing: UnresolvedWord[] = [];
  try {
    const parsed = JSON.parse(await readFile(UNRESOLVED, "utf8")) as unknown;
    if (Array.isArray(parsed)) {
      existing = parsed.filter((entry): entry is UnresolvedWord =>
        typeof entry === "object" && entry !== null &&
        typeof (entry as UnresolvedWord).word === "string" &&
        typeof (entry as UnresolvedWord).reason === "string",
      );
    }
  } catch {
    // A missing or malformed legacy report is replaced with valid entries.
  }
  const unique = new Map<string, UnresolvedWord>();
  for (const entry of [...existing, ...entries]) unique.set(`${entry.word}\u0000${entry.reason}`, entry);
  await writeFile(UNRESOLVED, `${JSON.stringify([...unique.values()], null, 2)}\n`, "utf8");
}

async function archive(clips: Clip[]): Promise<void> {
  await mkdir(RAW_DIR, { recursive: true });
  for (const clip of clips) {
    const name = `${clip.clippedAt.replace(/[:.]/g, "-")}-${slugify(clip.title || clip.url)}.md`;
    const provenance = [
      "---",
      `source_url: ${clip.url}`,
      `title: ${clip.title}`,
      `clipped_at: ${clip.clippedAt}`,
      "---",
      "",
      clip.text,
      "",
    ].join("\n");
    await appendFile(path.join(RAW_DIR, name), provenance, "utf8");
  }
  await rm(INBOX, { force: true });
}

async function main() {
  const args = parseArgs();
  const clips = await loadClips();
  if (clips.length === 0) {
    console.log("Inbox empty — nothing to ingest.");
    return;
  }
  const known = await canonicalLemmas();
  const frequency = new Map<string, number>();
  for (const clip of clips) for (const word of tokenize(clip.text)) {
    if (STOPWORDS.has(word) || known.has(word) || functionWordDefs[word]) continue;
    frequency.set(word, (frequency.get(word) ?? 0) + 1);
  }
  const unresolved = [...frequency.entries()]
    .sort((left, right) => right[1] - left[1] || (left[0] < right[0] ? -1 : 1))
    .slice(0, args.limit)
    .map(([word]) => ({ word, reason: "unknown canonical vocabulary word from clipped article" }));

  console.log(`Processed ${clips.length} clip(s): ${unresolved.length} unknown candidate(s), 0 advanced record(s) created.`);
  for (const entry of unresolved) console.log(`  unresolved ${entry.word}: ${entry.reason}`);
  if (args.dryRun) {
    console.log("Dry run: no raw archive, inbox, unresolved report, or vocabulary shards were written.");
    return;
  }
  await archive(clips);
  await reportUnresolved(unresolved);
  console.log("Archived clips and updated wiki/raw/unresolved.json; canonical vocabulary shards were unchanged.");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
