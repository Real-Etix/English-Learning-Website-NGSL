/**
 * Deterministic wiki seeder.
 *
 * Transforms the data we already have (data/generated/word-lists.json +
 * enrichments.json) into schema-conformant wiki/pages/<lemma>.md files.
 *
 * - No network calls: reproducible, no rate limits.
 * - Every seeded page is tier `core`, status `seeded`.
 * - The factual layer (definition/examples) comes from existing enrichment data.
 * - Seed connections are only the ones we can derive deterministically:
 *     - `domain:` tags from non-base list membership (business/academic/...)
 *     - `collocation: [[other]]` when a related phrase contains another known lemma
 *   Everything richer (synonym/intensity/builds_on) is left for the LLM pass.
 * - Existing pages are skipped unless --force, so hand-authored / verified
 *   pages are never clobbered.
 *
 * Usage:
 *   tsx scripts/seed-wiki-pages.ts [--limit=N] [--force] [--list=ngsl]
 */
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { functionWordDefs } from "../data/function-words";
import { getWordNetEntry, type WordNetEntry } from "./wordnet-source";
import type {
  GeneratedEnrichmentLibrary,
  ImportedCatalog,
  ImportedWord,
  WordEnrichment,
} from "../lib/types";

// List slugs that are NOT the base vocabulary become `domain` tags.
const BASE_LIST = "ngsl";
const DOMAIN_LABEL: Record<string, string> = {
  toeic: "toeic",
  business: "business",
  academic: "academic",
  fitness: "fitness",
};

const SOURCE_TAG: Record<string, string> = {
  dictionaryapi: "dictionaryapi",
  tatoeba: "tatoeba",
  fallback: "",
};

type ParsedArgs = {
  limit: number;
  force: boolean;
  list: string | null;
  wordnet: boolean;
};

function parseArgs(): ParsedArgs {
  const parsed: ParsedArgs = {
    limit: Number.POSITIVE_INFINITY,
    force: false,
    list: null,
    wordnet: true,
  };
  for (const arg of process.argv.slice(2)) {
    if (arg.startsWith("--limit=")) {
      parsed.limit = Number(arg.split("=")[1]) || parsed.limit;
    } else if (arg === "--force") {
      parsed.force = true;
    } else if (arg === "--no-wordnet") {
      parsed.wordnet = false;
    } else if (arg.startsWith("--list=")) {
      parsed.list = arg.split("=")[1] || null;
    }
  }
  return parsed;
}

/** Advanced-vocab candidate: a WordNet relation pointing at a word we have no page for. */
type IngestCandidate = { relation: "synonym" | "antonym"; anchor: string };

function normalizeToken(value: string) {
  return value.toLowerCase().replace(/[^a-z'-]/g, "");
}

type WordRecord = {
  word: ImportedWord;
  lists: Set<string>;
  bestRank: number | null;
  bestSfi: number | null;
};

/** A page is one clean word: letters, apostrophe or single hyphens only (also a safe filename). */
export function isSafeLemma(lemma: string): boolean {
  return /^[a-z]+(['-][a-z]+)*$/.test(lemma);
}

/** Strip diacritics: "café" -> "cafe", "résumé" -> "resume". */
function deaccent(value: string): string {
  return value.normalize("NFD").replace(/[̀-ͯ]/g, "");
}

// A few source rows had their accented letter destroyed to U+FFFD (`�`) by an
// upstream encoding bug, so the accent is unrecoverable from the data. We know
// these three, so restore them by hand. ("résumé" maps to the existing "resume".)
const CORRUPTED_FIXUPS: Record<string, { lemma: string; display: string }> = {
  "caf�": { lemma: "cafe", display: "café" },
  "r�sum�": { lemma: "resume", display: "résumé" },
  "entr�e": { lemma: "entree", display: "entrée" },
};

/**
 * Turn one source entry into one or more clean page entries.
 * - "abdominal / abs" -> two words (full term + gym short form)
 * - "ice cream"       -> one page, lemma "ice-cream", display "ice cream"
 * - "café"            -> lemma "cafe", display "café"
 * Display keeps the human spelling; the lemma is a safe single-token slug.
 */
function expandEntries(word: ImportedWord): Array<{ lemma: string; word: ImportedWord }> {
  const parts = word.lemma.includes("/") ? word.lemma.split("/") : [word.lemma];
  const isSplit = parts.length > 1;
  const out: Array<{ lemma: string; word: ImportedWord }> = [];
  for (const part of parts) {
    const display = part.trim();
    if (!display) continue;

    const fix = CORRUPTED_FIXUPS[display.toLowerCase()];
    if (fix) {
      out.push({
        lemma: fix.lemma,
        word: { ...word, lemma: fix.display, normalizedLemma: fix.lemma, forms: [fix.display] },
      });
      continue;
    }
    if (display.includes("�")) continue; // corrupted beyond recovery — don't make a stub

    const lemma = deaccent(display)
      .toLowerCase()
      .replace(/\s+/g, "-")
      .replace(/[^a-z'-]/g, "");
    if (!lemma || !isSafeLemma(lemma)) continue;
    out.push({
      lemma,
      word: {
        ...word,
        lemma: display,
        normalizedLemma: lemma,
        forms: isSplit ? [display] : word.forms,
      },
    });
  }
  return out;
}

/** Merge every list a lemma appears in; keep its most-frequent rank/sfi. */
function collectWords(catalog: ImportedCatalog): { byLemma: Map<string, WordRecord>; skipped: number } {
  const byLemma = new Map<string, WordRecord>();
  const skippedRaw = new Set<string>();
  for (const list of catalog.lists) {
    for (const source of list.words) {
      const entries = expandEntries(source);
      if (entries.length === 0) {
        skippedRaw.add(source.normalizedLemma);
        continue;
      }
      for (const { lemma: key, word } of entries) {
        const existing = byLemma.get(key);
        if (!existing) {
          byLemma.set(key, {
            word,
            lists: new Set([list.slug]),
            bestRank: word.rank,
            bestSfi: word.sfi,
          });
          continue;
        }
        existing.lists.add(list.slug);
        if (word.rank != null && (existing.bestRank == null || word.rank < existing.bestRank)) {
          existing.bestRank = word.rank;
        }
        if (word.sfi != null && (existing.bestSfi == null || word.sfi > existing.bestSfi)) {
          existing.bestSfi = word.sfi;
        }
      }
    }
  }
  return { byLemma, skipped: skippedRaw.size };
}

/** Collocation links: related phrases / phrasal verbs that mention another known lemma. */
function deriveCollocations(
  lemma: string,
  enrichment: WordEnrichment | undefined,
  knownLemmas: Set<string>,
): string[] {
  if (!enrichment) return [];
  const phrases = [...enrichment.relatedPhrases, ...enrichment.phrasalVerbs];
  const targets = new Set<string>();
  for (const phrase of phrases) {
    for (const token of phrase.split(/\s+/).map(normalizeToken)) {
      if (token && token !== lemma && knownLemmas.has(token)) {
        targets.add(token);
      }
    }
  }
  return Array.from(targets).slice(0, 4);
}

function yamlList(values: string[]): string {
  return `[${values.join(", ")}]`;
}

function buildPage(
  record: WordRecord,
  enrichment: WordEnrichment | undefined,
  knownLemmas: Set<string>,
  wordnet: WordNetEntry | null,
  candidates: Map<string, IngestCandidate[]>,
): string {
  const { word } = record;
  const lemma = word.normalizedLemma;
  const override = functionWordDefs[lemma];
  const isFallback = !enrichment || enrichment.contentStatus === "fallback";
  // Function words use the curated table; content words prefer WordNet.
  const useWordNet = !override && !!wordnet;

  const pos = override
    ? override.pos
    : useWordNet
      ? wordnet!.pos
      : enrichment && !isFallback
        ? enrichment.partOfSpeech
        : "unknown";

  const sourceTags: string[] = [];
  if (override) {
    sourceTags.push("curated");
  } else {
    if (useWordNet) sourceTags.push("wordnet");
    // Examples still come from the enrichment fetch, so credit it when used.
    if (enrichment?.exampleSentences.length) {
      for (const c of enrichment.sourceCredits) {
        const tag = SOURCE_TAG[c.id];
        if (tag) sourceTags.push(tag);
      }
    }
  }
  const sources = Array.from(new Set(sourceTags));

  // --- frontmatter ---
  const fm: string[] = [
    "---",
    `lemma: ${lemma}`,
    `display: ${word.lemma}`,
    "tier: core",
    `pos: ${pos}`,
    `forms: ${yamlList(word.forms.length ? word.forms : [word.lemma])}`,
    `lists: ${yamlList(Array.from(record.lists))}`,
  ];
  if (record.bestRank != null) fm.push(`rank: ${record.bestRank}`);
  if (record.bestSfi != null) fm.push(`sfi: ${record.bestSfi}`);
  fm.push(`sources: ${yamlList(sources)}`);
  // Curated function words are trustworthy; mark them verified so enrichment skips them.
  fm.push(`status: ${override ? "verified" : "seeded"}`);
  fm.push("---");

  // --- definition ---
  const definition = override
    ? override.definition
    : useWordNet
      ? wordnet!.definition
      : enrichment && !isFallback
        ? enrichment.definition
        : "_Definition pending — needs a fuller dictionary source before enrichment._";

  // --- examples --- (curated > real fetched sentences > WordNet usage examples)
  const exampleLines = override
    ? [`- ${override.example} _(curated)_`]
    : enrichment && enrichment.exampleSentences.length
      ? enrichment.exampleSentences.map((ex) => {
          const src = ex.source === "generated" ? "generated" : "dictionaryapi";
          return `- ${ex.text} _(${src})_`;
        })
      : useWordNet && wordnet!.examples.length
        ? wordnet!.examples.map((ex) => `- ${ex} _(wordnet)_`)
        : ["_No sourced examples yet._"];

  // --- connections ---
  const connections: string[] = [];

  // WordNet synonyms/antonyms: link when the target is a known page; otherwise
  // record it as an advanced-vocab ingest candidate (a word we should add later).
  const addRelation = (relation: "synonym" | "antonym", target: string) => {
    if (target === lemma) return;
    if (knownLemmas.has(target)) {
      connections.push(`- ${relation}: [[${target}]]`);
    } else {
      const list = candidates.get(target) ?? [];
      if (!list.some((c) => c.relation === relation && c.anchor === lemma)) {
        list.push({ relation, anchor: lemma });
      }
      candidates.set(target, list);
    }
  };
  if (useWordNet) {
    wordnet!.synonyms.slice(0, 6).forEach((s) => addRelation("synonym", s));
    wordnet!.antonyms.slice(0, 4).forEach((a) => addRelation("antonym", a));
  }

  for (const [slug, label] of Object.entries(DOMAIN_LABEL)) {
    if (record.lists.has(slug) && slug !== BASE_LIST) {
      connections.push(`- domain: ${label}`);
    }
  }
  for (const target of deriveCollocations(lemma, enrichment, knownLemmas)) {
    connections.push(`- collocation: [[${target}]]`);
  }
  if (connections.length === 0) {
    connections.push("<!-- awaiting LLM enrichment: intensity / advanced_form -->");
  }

  return [
    fm.join("\n"),
    "",
    "## Definition",
    definition,
    "",
    "## Examples",
    exampleLines.join("\n"),
    "",
    "## Connections",
    connections.join("\n"),
    "",
  ].join("\n");
}

async function main() {
  const args = parseArgs();
  const root = process.cwd();
  const dataDir = path.join(root, "data", "generated");
  const pagesDir = path.join(root, "wiki", "pages");

  const catalog = JSON.parse(
    await readFile(path.join(dataDir, "word-lists.json"), "utf8"),
  ) as ImportedCatalog;

  let enrichmentLib: GeneratedEnrichmentLibrary = { generatedAt: "", items: {} };
  try {
    enrichmentLib = JSON.parse(
      await readFile(path.join(dataDir, "enrichments.json"), "utf8"),
    ) as GeneratedEnrichmentLibrary;
  } catch {
    // enrichments are optional; pages still seed with pending definitions.
  }

  const { byLemma, skipped: skippedMalformed } = collectWords(catalog);
  const knownLemmas = new Set(byLemma.keys());
  if (skippedMalformed > 0) {
    console.log(`Skipped ${skippedMalformed} malformed lemma(s) (multi-word / slashed).`);
  }

  await mkdir(pagesDir, { recursive: true });
  const existing = new Set(
    (await readdir(pagesDir).catch(() => [] as string[]))
      .filter((f) => f.endsWith(".md"))
      .map((f) => f.replace(/\.md$/, "")),
  );

  let records = Array.from(byLemma.values());
  if (args.list) {
    records = records.filter((r) => r.lists.has(args.list!));
  }
  // Most-frequent first so a --limit run seeds the words that matter most.
  records.sort((a, b) => (a.bestRank ?? 1e9) - (b.bestRank ?? 1e9));

  const candidates = new Map<string, IngestCandidate[]>();
  let written = 0;
  let skipped = 0;
  for (const record of records) {
    if (written >= args.limit) break;
    const lemma = record.word.normalizedLemma;
    if (!args.force && existing.has(lemma)) {
      skipped += 1;
      continue;
    }
    const wordnet =
      args.wordnet && !functionWordDefs[lemma] ? await getWordNetEntry(lemma) : null;
    const page = buildPage(
      record,
      enrichmentLib.items[lemma],
      knownLemmas,
      wordnet,
      candidates,
    );
    await writeFile(path.join(pagesDir, `${lemma}.md`), page, "utf8");
    written += 1;
    if (written % 250 === 0) console.log(`Seeded ${written}/${records.length}...`);
  }

  // Advanced-vocab candidates: off-list words WordNet linked to core anchors.
  const candidatesPath = path.join(root, "wiki", "ingest-candidates.json");
  const rankedCandidates = Array.from(candidates.entries())
    .map(([word, links]) => ({ word, count: links.length, links }))
    .sort((a, b) => b.count - a.count);
  await writeFile(
    candidatesPath,
    `${JSON.stringify({ generatedAt: new Date().toISOString(), candidates: rankedCandidates }, null, 2)}\n`,
    "utf8",
  );

  console.log(
    `Seeded ${written} page(s), skipped ${skipped} existing. Total unique lemmas: ${byLemma.size}.`,
  );
  console.log(
    `Found ${rankedCandidates.length} advanced-vocab candidates → ${path.relative(root, candidatesPath)}`,
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
