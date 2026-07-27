/**
 * LLM enrichment pass — the one step that needs a model.
 *
 * WordNet gave us definitions + synonym/antonym edges for free. What it CANNOT
 * give is the "graduate to a more advanced word" ladder (buy → purchase → procure).
 * This pass asks Kimi for `advanced_form` links per core word, creates advanced
 * pages for new words (anchored back with `builds_on`), and marks pages `enriched`.
 *
 * Model config lives in scripts/llm-client.ts (.env: LLM_API_KEY / LLM_MODEL).
 * --dry-run works with NO key: it applies a small built-in stub so the write path
 * is verifiable for free.
 *
 * Usage: tsx scripts/enrich-wiki-llm.ts [--limit=N] [--list=ngsl] [--dry-run] [--force]
 */
import { readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { CONTENT_POS, grammarStopwords } from "../data/grammar-words";
import { parsePage } from "../lib/wiki/parse-wiki";
import { completeJSON, hasLLM, LLM_ENDPOINT, LLM_MODEL } from "./llm-client";
import { appendConnection, mergeSources, newAdvancedPage, setFrontmatterField } from "./wiki-edit";

const PAGES_DIR = path.join(process.cwd(), "wiki", "pages");

type AdvancedForm = { word: string; definition: string; gloss: string };
type ParsedArgs = {
  limit: number;
  list: string | null;
  dryRun: boolean;
  force: boolean;
  model: string;
  concurrency: number;
};

function parseArgs(): ParsedArgs {
  const p: ParsedArgs = { limit: 10, list: null, dryRun: false, force: false, model: LLM_MODEL, concurrency: 4 };
  for (const arg of process.argv.slice(2)) {
    if (arg.startsWith("--limit=")) p.limit = Number(arg.split("=")[1]) || p.limit;
    else if (arg.startsWith("--list=")) p.list = arg.split("=")[1] || null;
    else if (arg.startsWith("--model=")) p.model = arg.split("=")[1] || p.model;
    else if (arg.startsWith("--concurrency=")) p.concurrency = Math.max(1, Number(arg.split("=")[1]) || p.concurrency);
    else if (arg === "--dry-run") p.dryRun = true;
    else if (arg === "--force") p.force = true;
  }
  return p;
}

const normalize = (word: string) => word.toLowerCase().replace(/[^a-z'-]/g, "");

const SYSTEM_PROMPT =
  "You help English learners graduate from common words to more advanced, natural " +
  "vocabulary. Given a common word, propose 2-3 more advanced or formal single-word " +
  "synonyms a learner should level up to. Only real, standard modern English words; " +
  "no rare or archaic ones. Respond with STRICT JSON only, no prose.";

function buildUserPrompt(word: string, pos: string, definition: string): string {
  return JSON.stringify({
    task: "advanced_forms",
    word,
    pos,
    definition,
    format: {
      advanced_forms: [{ word: "string", definition: "one short learner sentence", gloss: "when to use it vs the common word" }],
    },
  });
}

// Offline stub so --dry-run (and no-key runs) exercise the write path for free.
const STUB: Record<string, AdvancedForm[]> = {
  big: [
    { word: "enormous", definition: "extremely large in size or degree", gloss: "when 'big' is an understatement" },
    { word: "substantial", definition: "large in amount, size, or importance", gloss: "formal, common in writing" },
  ],
  good: [
    { word: "excellent", definition: "extremely good; of the highest quality", gloss: "stronger praise than 'good'" },
    { word: "superb", definition: "outstandingly good", gloss: "emphatic, slightly formal" },
  ],
  work: [
    { word: "operate", definition: "to function or make something function", gloss: "for machines/systems" },
    { word: "labor", definition: "to work hard, especially physically", gloss: "formal or literary" },
  ],
};

async function requestAdvancedForms(args: ParsedArgs, word: string, pos: string, definition: string): Promise<AdvancedForm[]> {
  if (args.dryRun || !hasLLM()) return STUB[word] ?? [];
  const out = await completeJSON<{ advanced_forms?: AdvancedForm[] }>(
    SYSTEM_PROMPT,
    buildUserPrompt(word, pos, definition),
    args.model,
  );
  return (out?.advanced_forms ?? []).filter((a) => a.word && a.definition);
}

async function main() {
  const args = parseArgs();
  const mode = args.dryRun || !hasLLM() ? "DRY-RUN (stub)" : "LIVE";
  console.log(`Enrichment ${mode} · model=${args.model} · endpoint=${LLM_ENDPOINT}`);

  const files = (await readdir(PAGES_DIR).catch(() => [] as string[])).filter((f) => f.endsWith(".md"));
  const rawByLemma = new Map<string, string>();
  for (const f of files) rawByLemma.set(f.replace(/\.md$/, ""), await readFile(path.join(PAGES_DIR, f), "utf8"));

  const targets: string[] = [];
  for (const [lemma, raw] of rawByLemma) {
    const page = parsePage(raw);
    if (!page || page.tier !== "core" || page.status === "verified") continue;
    if (!args.force && page.status === "enriched") continue;
    if (args.list && !page.lists.includes(args.list)) continue;
    // Only content words get advanced ladders — grammar words (can/there/who) don't.
    if (!CONTENT_POS.has(page.pos) || grammarStopwords.has(lemma)) continue;
    targets.push(lemma);
  }
  targets.sort((a, b) => (parsePage(rawByLemma.get(a)!)!.rank ?? 1e9) - (parsePage(rawByLemma.get(b)!)!.rank ?? 1e9));
  const selected = targets.slice(0, args.limit);
  console.log(`${selected.length} content word(s) to enrich · concurrency ${args.concurrency}`);

  let enriched = 0;
  let newPages = 0;
  let addedEdges = 0;

  // Apply one word's advanced_forms to the wiki. Sequential: mutates the shared map + files.
  async function applyForms(lemma: string, forms: AdvancedForm[]) {
    const page = parsePage(rawByLemma.get(lemma)!)!;
    let coreRaw = rawByLemma.get(lemma)!;
    for (const form of forms) {
      const target = normalize(form.word);
      if (!target || target === lemma || grammarStopwords.has(target)) continue;
      if (page.connections.some((c) => c.type === "advanced_form" && c.target === target)) continue;

      coreRaw = appendConnection(coreRaw, `- advanced_form: [[${target}]] — ${form.gloss}`);
      addedEdges += 1;

      if (!rawByLemma.has(target)) {
        const advanced = newAdvancedPage({
          word: target,
          pos: page.pos,
          definition: form.definition,
          anchor: lemma,
          gloss: form.gloss,
          sources: ["llm"],
          status: "enriched",
        });
        rawByLemma.set(target, advanced);
        await writeFile(path.join(PAGES_DIR, `${target}.md`), advanced, "utf8");
        newPages += 1;
      } else {
        let tRaw = rawByLemma.get(target)!;
        const tPage = parsePage(tRaw)!;
        if (!tPage.connections.some((c) => c.type === "builds_on" && c.target === lemma)) {
          tRaw = appendConnection(tRaw, `- builds_on: [[${lemma}]] — ${form.gloss}`);
          rawByLemma.set(target, tRaw);
          await writeFile(path.join(PAGES_DIR, `${target}.md`), tRaw, "utf8");
        }
      }
    }
    coreRaw = mergeSources(coreRaw, "llm");
    coreRaw = setFrontmatterField(coreRaw, "status", "enriched");
    rawByLemma.set(lemma, coreRaw);
    await writeFile(path.join(PAGES_DIR, `${lemma}.md`), coreRaw, "utf8");
    enriched += 1;
  }

  // Fetch in parallel batches (the slow, network-bound part); apply sequentially (safe writes).
  for (let i = 0; i < selected.length; i += args.concurrency) {
    const batch = selected.slice(i, i + args.concurrency);
    const fetched = await Promise.all(
      batch.map(async (lemma) => {
        const page = parsePage(rawByLemma.get(lemma)!)!;
        return { lemma, forms: await requestAdvancedForms(args, lemma, page.pos, page.definition) };
      }),
    );
    for (const { lemma, forms } of fetched) {
      if (forms.length > 0) await applyForms(lemma, forms);
    }
    console.log(`  …${Math.min(i + args.concurrency, selected.length)}/${selected.length} processed (${newPages} new pages)`);
  }

  console.log(`\nEnriched ${enriched} core page(s), created ${newPages} advanced page(s), added ${addedEdges} advanced_form edge(s).`);
  if (args.dryRun || !hasLLM()) console.log("(dry-run / no LLM_API_KEY — used built-in stub.)");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
