/**
 * Pre-generate the per-list graph JSON so pages don't read 11k wiki files at
 * build/request time. Reads every page ONCE here; the app then loads a small
 * JSON per list. Re-run after changing the wiki (seed/enrich).
 *
 * Usage: tsx scripts/build-graph-data.ts
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { buildListGraph, readAllPages, toLiteGraph } from "../lib/wiki/parse-wiki";

const SLUGS = ["ngsl", "toeic", "business", "academic", "fitness", "all"];

async function main() {
  const pages = await readAllPages();
  const dir = path.join(process.cwd(), "data", "generated", "graphs");
  await mkdir(dir, { recursive: true });

  // Optional themed chart names from scripts/name-charts.ts (falls back to hub names).
  let chartNames: Record<string, Record<string, string>> = {};
  try { chartNames = JSON.parse(await readFile(path.join(process.cwd(), "data", "generated", "chart-names.json"), "utf8")); } catch { /* not generated yet */ }

  for (const slug of SLUGS) {
    const graph = toLiteGraph(buildListGraph(pages, slug));
    if (chartNames[slug]) graph.chartNames = chartNames[slug];
    await writeFile(path.join(dir, `${slug}.json`), JSON.stringify(graph));
    const kb = (Buffer.byteLength(JSON.stringify(graph)) / 1024).toFixed(0);
    console.log(`  ${slug.padEnd(9)} ${String(graph.nodes.length).padStart(6)} nodes · ${String(graph.edges.length).padStart(6)} edges · ${kb}KB`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
