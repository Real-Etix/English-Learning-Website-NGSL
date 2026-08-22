/**
 * Theme each chart with a short, human name (a chapter title) instead of its
 * hub word. Runs the LLM over each Louvain cluster's member words and writes
 * `data/generated/chart-names.json` ({ [listSlug]: { [chartId]: name } }).
 *
 * Cached + resumable: re-running only names charts not already in the cache.
 * build-graph-data.ts folds these names into each list's graph JSON.
 *
 * Usage:
 *   tsx scripts/name-charts.ts                 # all lists
 *   tsx scripts/name-charts.ts --list=ngsl     # one list
 *   tsx scripts/name-charts.ts --list=ngsl --limit=20 --force
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { completeJSON, hasLLM, LLM_MODEL } from "./llm-client";
import { buildListGraph, type GraphNode } from "../lib/vocabulary/graph";
import { toGraphInput } from "../lib/vocabulary/graph-input";
import { openNdjsonRepository } from "../lib/vocabulary/ndjson-repository";
import type { VocabularyRecord } from "../lib/vocabulary/schema";

const SLUGS = ["ngsl", "toeic", "business", "academic", "fitness", "all"];
const OUT = path.join(process.cwd(), "data", "generated", "chart-names.json");
// Chart naming is non-critical (misses fall back to hub names), so fail fast:
// a per-call cap keeps one hung request from stalling the whole batch.
const CONCURRENCY = 10;
const CALL_TIMEOUT_MS = 20_000;

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T | null> {
  return Promise.race([p, new Promise<null>((r) => setTimeout(() => r(null), ms))]);
}

type Cache = Record<string, Record<string, string>>;

function args() {
  const a = process.argv.slice(2);
  const get = (k: string) => a.find((x) => x.startsWith(`--${k}=`))?.split("=")[1];
  return {
    list: get("list"),
    limit: get("limit") ? Number(get("limit")) : Infinity,
    force: a.includes("--force"),
    offline: a.includes("--offline"),
  };
}

async function loadCache(): Promise<Cache> {
  try { return JSON.parse(await readFile(OUT, "utf8")); } catch { return {}; }
}

const SYSTEM =
  "You name a cluster of related English vocabulary words with a short human theme — like a chapter title. " +
  "1 to 3 words, Title Case, evocative but plain (e.g. 'Money & Trade', 'Time', 'Cause & Effect', 'The Body'). " +
  "Not a definition, not a sentence, not one of the words verbatim unless it truly is the theme. Reply JSON only.";

function fallbackName(chartId: string): string {
  return chartId
    .replace(/[-_]+/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase())
    .slice(0, 28);
}

async function nameChart(words: string[]): Promise<string | null> {
  const res = await withTimeout(
    completeJSON<{ name?: string }>(
      SYSTEM,
      `Words in this cluster: ${words.join(", ")}.\nReply: {"name":"<theme, 1-3 words, Title Case>"}`,
      LLM_MODEL,
      2, // one retry, not four — a miss just falls back to the hub name
    ),
    CALL_TIMEOUT_MS,
  );
  const name = res?.name?.trim();
  if (!name) return null;
  // keep it short + clean
  return name.replace(/["“”.]/g, "").split(/\s+/).slice(0, 3).join(" ").slice(0, 28) || null;
}

async function main() {
  if (!hasLLM()) { console.error("No LLM configured (set LLM_API_KEY). Aborting."); process.exitCode = 1; return; }
  const { list, limit, force, offline } = args();
  const slugs = list ? [list] : SLUGS;
  const records: VocabularyRecord[] = [];
  for await (const record of openNdjsonRepository().all()) records.push(record);
  const inputs = records.map((record) => toGraphInput(record, { records }));
  const cache = force ? {} : await loadCache();
  await mkdir(path.dirname(OUT), { recursive: true });

  for (const slug of slugs) {
    const graph = buildListGraph(inputs, slug);
    const byChart = new Map<string, GraphNode[]>();
    for (const n of graph.nodes) {
      if (!n.chart || n.chart === "drift") continue;
      (byChart.get(n.chart) ?? byChart.set(n.chart, []).get(n.chart)!).push(n);
    }
    const existing = (cache[slug] ??= {});
    const todo = [...byChart.keys()].filter((id) => force || !existing[id]).slice(0, limit);
    console.log(`${slug}: ${byChart.size} charts · naming ${todo.length}${force ? " (force)" : ""}${offline ? " (offline fallback)" : ""}`);

    let done = 0;
    for (let i = 0; i < todo.length; i += CONCURRENCY) {
      const batch = todo.slice(i, i + CONCURRENCY);
      await Promise.all(batch.map(async (id) => {
        const members = byChart.get(id)!.slice().sort((a, b) => b.degree - a.degree).slice(0, 14).map((n) => n.display);
        const name = offline ? null : await nameChart(members);
        existing[id] = name ?? fallbackName(id);
      }));
      done += batch.length;
      await writeFile(OUT, JSON.stringify(cache, null, 0)); // checkpoint (resumable)
      process.stdout.write(`\r  ${done}/${todo.length}`);
    }
    process.stdout.write("\n");
  }
  console.log(`Wrote ${OUT}`);
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
