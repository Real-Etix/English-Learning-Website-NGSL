/**
 * Add "sideways" links to the wiki — synonym + collocation edges between words
 * that ALREADY exist as pages. The graph is dominated by advanced_form stars
 * (a word → its fancier forms) with little lateral tissue, so many words sit in
 * tiny components and end up as unclustered "drift". This pass asks the model,
 * per under-connected word, for its synonyms and common collocates, keeps only
 * the ones that are real wiki pages, and writes the edges both ways.
 *
 * Cheap-first + resumable: fast per-call timeout (a miss just adds no edge), a
 * done-set cache so re-runs skip processed words, and sequential file writes so
 * two words never clobber the same page.
 *
 * Usage:
 *   tsx scripts/enrich-links.ts --list=fitness            # words in one list
 *   tsx scripts/enrich-links.ts --max-degree=2 --limit=300
 *   tsx scripts/enrich-links.ts --list=fitness --force
 */
import { readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { completeJSON, hasLLM, LLM_MODEL } from "./llm-client";
import { appendConnection } from "./wiki-edit";
import { buildListGraph, readAllPages, type WikiPage } from "../lib/wiki/parse-wiki";

const PAGES_DIR = path.join(process.cwd(), "wiki", "pages");
const DONE = path.join(process.cwd(), "data", "generated", "sidelinks-done.json");
const CONCURRENCY = 8;
const CALL_TIMEOUT_MS = 20_000;
const MAX_ADD = 5; // cap new edges per word so we don't over-connect hubs

const norm = (s: string) => String(s || "").toLowerCase().trim().replace(/[^a-z]/g, "");
function withTimeout<T>(p: Promise<T>, ms: number): Promise<T | null> {
  return Promise.race([p, new Promise<null>((r) => setTimeout(() => r(null), ms))]);
}

function args() {
  const a = process.argv.slice(2);
  const get = (k: string) => a.find((x) => x.startsWith(`--${k}=`))?.split("=")[1];
  return {
    list: get("list"),
    maxDegree: get("max-degree") ? Number(get("max-degree")) : 3,
    limit: get("limit") ? Number(get("limit")) : Infinity,
    force: a.includes("--force"),
  };
}

const SYSTEM =
  "You give lateral vocabulary links for an English word. Only real, common modern English words. " +
  "synonyms: words with nearly the same meaning. collocations: everyday words that frequently appear right next to it. " +
  "No morphological variants (run/running), no rare words, no the/of/a. Reply JSON only.";

async function askLinks(word: string, pos: string, def: string): Promise<{ synonyms: string[]; collocations: string[] } | null> {
  const res = await withTimeout(
    completeJSON<{ synonyms?: string[]; collocations?: string[] }>(
      SYSTEM,
      `Word: "${word}" (${pos}) — ${def}\nReply: {"synonyms":["..."],"collocations":["..."]} (up to 5 each, omit if none).`,
      LLM_MODEL,
      2,
    ),
    CALL_TIMEOUT_MS,
  );
  if (!res) return null;
  return { synonyms: (res.synonyms ?? []).slice(0, 8), collocations: (res.collocations ?? []).slice(0, 8) };
}

async function main() {
  if (!hasLLM()) { console.error("No LLM configured (set LLM_API_KEY)."); process.exitCode = 1; return; }
  const a = args();
  const pages = await readAllPages();
  const byNorm = new Map<string, WikiPage>();
  for (const p of pages) byNorm.set(norm(p.lemma), p);

  // Under-connectivity is measured WHERE it matters: within the list's own
  // subgraph when --list is set (that's where drift comes from), else globally.
  const degree = new Map<string, number>();
  if (a.list) {
    for (const n of buildListGraph(pages, a.list).nodes) degree.set(n.lemma, n.degree);
  } else {
    for (const p of pages) for (const c of p.connections) {
      degree.set(p.lemma, (degree.get(p.lemma) ?? 0) + 1);
      degree.set(c.target, (degree.get(c.target) ?? 0) + 1);
    }
  }

  const inList = (p: WikiPage) => !a.list || p.lists.includes(a.list);
  let done: Set<string>;
  try { done = new Set(a.force ? [] : JSON.parse(await readFile(DONE, "utf8"))); } catch { done = new Set(); }

  const candidates = pages
    .filter((p) => inList(p) && (degree.get(p.lemma) ?? 0) < a.maxDegree && !done.has(p.lemma))
    .slice(0, a.limit);
  console.log(`enriching ${candidates.length} under-connected word(s)${a.list ? ` in ${a.list}` : ""} (degree < ${a.maxDegree})`);

  // raw markdown cache — mutate in memory, write changed files at the end (no races)
  const files = (await readdir(PAGES_DIR)).filter((f) => f.endsWith(".md"));
  const rawByLemma = new Map<string, string>();
  const has = new Set(files.map((f) => f.replace(/\.md$/, "")));
  const load = async (lemma: string) => {
    if (rawByLemma.has(lemma)) return rawByLemma.get(lemma)!;
    const raw = await readFile(path.join(PAGES_DIR, `${lemma}.md`), "utf8").catch(() => "");
    rawByLemma.set(lemma, raw);
    return raw;
  };
  const changed = new Set<string>();
  const existingEdge = (raw: string, type: string, target: string) => new RegExp(`^-\\s+${type}:\\s*\\[\\[${target}\\]\\]`, "m").test(raw);

  const addEdge = async (from: string, to: string, type: "synonym" | "collocation") => {
    if (from === to || !has.has(from) || !has.has(to)) return;
    const raw = await load(from);
    if (existingEdge(raw, type, to) || existingEdge(raw, "advanced_form", to) || existingEdge(raw, "builds_on", to)) return;
    rawByLemma.set(from, appendConnection(raw, `- ${type}: [[${to}]]`));
    changed.add(from);
  };

  let processed = 0;
  for (let i = 0; i < candidates.length; i += CONCURRENCY) {
    const batch = candidates.slice(i, i + CONCURRENCY);
    const results = await Promise.all(batch.map(async (p) => ({ p, links: await askLinks(p.display, p.pos, p.definition) })));
    for (const { p, links } of results) {
      done.add(p.lemma);
      if (!links) continue;
      let n = 0; // new edges added for this word (capped)
      const tryAdd = async (word: string, type: "synonym" | "collocation") => {
        if (n >= MAX_ADD) return;
        const t = byNorm.get(norm(word));
        if (!t || t.lemma === p.lemma) return;
        const before = changed.size;
        await addEdge(p.lemma, t.lemma, type); // both directions — lateral links are symmetric
        await addEdge(t.lemma, p.lemma, type);
        if (changed.size > before) n++;
      };
      for (const w of links.synonyms) await tryAdd(w, "synonym");
      for (const w of links.collocations) await tryAdd(w, "collocation");
    }
    processed += batch.length;
    await writeFile(DONE, JSON.stringify([...done]));
    process.stdout.write(`\r  ${processed}/${candidates.length} · ${changed.size} pages touched`);
  }
  process.stdout.write("\n");

  // flush changed pages
  for (const lemma of changed) await writeFile(path.join(PAGES_DIR, `${lemma}.md`), rawByLemma.get(lemma)!, "utf8");
  console.log(`wrote ${changed.size} pages. Re-run: npm run build:graphs`);
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
