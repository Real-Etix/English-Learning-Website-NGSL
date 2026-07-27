/**
 * `ingest` — drain the clip inbox into the wiki.
 *
 * Reads wiki/raw/inbox.jsonl (filled by the Chrome extension), finds new content
 * words, anchors each to a word you already know, and writes an `advanced` page
 * with a `builds_on` edge back to that anchor. Then archives the raw clips and
 * empties the inbox.
 *
 * Anchoring strategy (cheap-first):
 *   1. WordNet — a synonym/antonym that is already a page becomes the anchor.
 *   2. Kimi (if LLM_API_KEY set) — asks for a common-word anchor + definition.
 *   3. Otherwise the word is parked in wiki/raw/unresolved.json for review.
 *
 * Usage: tsx scripts/ingest-clips.ts [--limit=N] [--dry-run]
 */
import "dotenv/config";
import { appendFile, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import { functionWordDefs } from "../data/function-words";
import { parsePage } from "../lib/wiki/parse-wiki";
import { completeJSON, hasLLM, LLM_MODEL } from "./llm-client";
import { appendConnection, mergeSources, newAdvancedPage } from "./wiki-edit";
import { getWordNetEntry } from "./wordnet-source";

const ROOT = process.cwd();
const PAGES_DIR = path.join(ROOT, "wiki", "pages");
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

function parseArgs() {
  const p = { limit: 40, dryRun: false };
  for (const a of process.argv.slice(2)) {
    if (a.startsWith("--limit=")) p.limit = Number(a.split("=")[1]) || p.limit;
    else if (a === "--dry-run") p.dryRun = true;
  }
  return p;
}

function tokenize(text: string): string[] {
  return (text.toLowerCase().match(/[a-z][a-z'-]{2,}/g) ?? []).map((t) =>
    t.replace(/^['-]+|['-]+$/g, ""),
  );
}

function slugify(s: string) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "clip";
}

async function loadClips(): Promise<Clip[]> {
  try {
    const raw = await readFile(INBOX, "utf8");
    return raw
      .split("\n")
      .filter((l) => l.trim())
      .map((l) => JSON.parse(l) as Clip);
  } catch {
    return [];
  }
}

/** All page lemmas, and the subset that are core-tier (valid anchors). */
async function loadPages(): Promise<{ all: Set<string>; core: Set<string> }> {
  const files = (await readdir(PAGES_DIR).catch(() => [] as string[])).filter((f) => f.endsWith(".md"));
  const all = new Set<string>();
  const core = new Set<string>();
  for (const f of files) {
    const lemma = f.replace(/\.md$/, "");
    all.add(lemma);
    const page = parsePage(await readFile(path.join(PAGES_DIR, f), "utf8"));
    if (page?.tier === "core") core.add(lemma);
  }
  return { all, core };
}

/** Ask Kimi for a definition + a common-word anchor that is a core page. */
async function llmAnchor(word: string, context: string, core: Set<string>) {
  const system =
    "You help map advanced English words to a simpler, common 'anchor' word a beginner " +
    "already knows. Respond with STRICT JSON only.";
  const user = JSON.stringify({
    word,
    context_sentence: context.slice(0, 300),
    instructions: "Give a one-sentence learner definition and ONE common everyday anchor word.",
    format: { definition: "string", anchor: "single common word", pos: "noun|verb|adjective|adverb" },
  });
  const out = await completeJSON<{ definition: string; anchor: string; pos: string }>(system, user);
  if (!out?.anchor || !out.definition) return null;
  const anchor = out.anchor.toLowerCase().replace(/[^a-z'-]/g, "");
  return core.has(anchor) ? { ...out, anchor } : null;
}

async function main() {
  const args = parseArgs();
  console.log(`Ingest ${args.dryRun || !hasLLM() ? "(WordNet only)" : `(WordNet + ${LLM_MODEL})`}`);

  const clips = await loadClips();
  if (clips.length === 0) {
    console.log("Inbox empty — nothing to ingest.");
    return;
  }

  const { all: pages, core } = await loadPages();

  // Count new content words across all clips, remember a context sentence for each.
  const freq = new Map<string, number>();
  const context = new Map<string, string>();
  for (const clip of clips) {
    for (const token of tokenize(clip.text)) {
      if (STOPWORDS.has(token) || pages.has(token) || functionWordDefs[token]) continue;
      freq.set(token, (freq.get(token) ?? 0) + 1);
      if (!context.has(token)) context.set(token, clip.text);
    }
  }

  const candidates = Array.from(freq.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, args.limit)
    .map(([word]) => word);

  const unresolved: Array<{ word: string; reason: string }> = [];
  let created = 0;
  let edges = 0;

  for (const word of candidates) {
    const wn = await getWordNetEntry(word);

    // 1. WordNet anchor: a related word that already has a page.
    let anchor: string | null = null;
    let definition = wn?.definition ?? "";
    let pos = wn?.pos ?? "unknown";
    let gloss = "advanced word from a clipped article";
    let status: "seeded" | "enriched" = "seeded";
    const sources: string[] = [];

    if (wn) {
      // Anchor must be a CORE word (the anchor rule) — never another advanced page.
      anchor = [...wn.synonyms, ...wn.antonyms].find((w) => core.has(w)) ?? null;
      if (anchor) sources.push("wordnet");
    }

    // 2. Kimi fallback for definition + anchor.
    if (!anchor && !args.dryRun && hasLLM()) {
      const llm = await llmAnchor(word, context.get(word) ?? word, core);
      if (llm) {
        anchor = llm.anchor;
        definition = llm.definition;
        pos = llm.pos || pos;
        gloss = `clipped word; graduate here from "${llm.anchor}"`;
        status = "enriched";
        sources.push("llm");
      }
    }

    if (!anchor || !definition) {
      unresolved.push({ word, reason: !anchor ? "no anchor in wiki" : "no definition" });
      continue;
    }

    console.log(`  ${word} → builds_on ${anchor} (${sources.join("+")})`);
    if (args.dryRun) {
      created += 1;
      continue;
    }

    // Write the new advanced page.
    const page = newAdvancedPage({
      word,
      pos,
      definition,
      anchor,
      gloss,
      sources: sources.length ? sources : ["clip"],
      status,
      examples: wn?.examples,
    });
    await writeFile(path.join(PAGES_DIR, `${word}.md`), page, "utf8");
    pages.add(word);
    created += 1;

    // Reciprocal advanced_form on the anchor (appending a link is allowed even on verified pages).
    const anchorPath = path.join(PAGES_DIR, `${anchor}.md`);
    let anchorRaw = await readFile(anchorPath, "utf8");
    const anchorPage = parsePage(anchorRaw);
    if (anchorPage && !anchorPage.connections.some((c) => c.type === "advanced_form" && c.target === word)) {
      anchorRaw = appendConnection(anchorRaw, `- advanced_form: [[${word}]] — ${gloss}`);
      anchorRaw = mergeSources(anchorRaw, sources[0] ?? "clip");
      await writeFile(anchorPath, anchorRaw, "utf8");
      edges += 1;
    }
  }

  // Archive raw clips and drain the inbox (skip in dry-run).
  if (!args.dryRun) {
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
    if (unresolved.length) {
      await writeFile(UNRESOLVED, `${JSON.stringify(unresolved, null, 2)}\n`, "utf8");
    }
  }

  console.log(
    `\nProcessed ${clips.length} clip(s): created ${created} advanced page(s), ${edges} reciprocal edge(s), ${unresolved.length} unresolved.`,
  );
  if (!args.dryRun) console.log("Run `npx tsx scripts/lint-wiki.ts` to verify consistency.");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
