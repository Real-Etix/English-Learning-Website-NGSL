/**
 * Cluster the canonical vocabulary graph into charts and regions, then write
 * `chart` / `region` back to canonical NDJSON records. This is the spatial
 * hierarchy the Star Atlas renderer needs to
 * scale (its layout is chart-scoped).
 *
 * Method (dependency-free): label propagation for base communities, then greedy
 * agglomeration of small ones and BFS-splitting of large ones to control size.
 * Charts/regions are named after their hub word (highest degree, lowest rank).
 * Isolated words (no in-graph edges) go to a "drift" chart, excluded from seals.
 *
 * Usage: tsx scripts/build-charts.ts [--write]   (dry-run unless --write)
 */
import path from "node:path";

import { toGraphInput, type GraphInput } from "../lib/vocabulary/graph-input";
import { openNdjsonRepository, writeVocabularyRecords } from "../lib/vocabulary/ndjson-repository";
import type { VocabularyRecord } from "../lib/vocabulary/schema";

const CHART_MIN = 10;
const CHART_TARGET = 15;
const CHART_CAP = 24;
const REGION_CAP = 16;

const write = process.argv.includes("--write");

type Node = { lemma: string; degree: number; rank: number | null };

function buildAdjacency(pages: GraphInput[]) {
  const has = new Set(pages.map((p) => p.lemma));
  const adj = new Map<string, Set<string>>();
  const add = (a: string, b: string) => {
    (adj.get(a) ?? adj.set(a, new Set()).get(a)!).add(b);
  };
  for (const p of pages) {
    for (const c of p.connections) {
      if (!has.has(c.target) || c.target === p.lemma) continue;
      add(p.lemma, c.target);
      add(c.target, p.lemma);
    }
  }
  return adj;
}

/** Synchronous label propagation with a deterministic tie-break. */
function labelPropagation(nodes: string[], adj: Map<string, Set<string>>): Map<string, string> {
  const label = new Map(nodes.map((n) => [n, n]));
  const order = [...nodes].sort();
  for (let round = 0; round < 20; round += 1) {
    let changed = 0;
    for (const v of order) {
      const nbrs = adj.get(v);
      if (!nbrs || nbrs.size === 0) continue;
      const counts = new Map<string, number>();
      for (const u of nbrs) {
        const l = label.get(u)!;
        counts.set(l, (counts.get(l) ?? 0) + 1);
      }
      let best = label.get(v)!;
      let bestC = -1;
      for (const [l, c] of [...counts].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))) {
        if (c > bestC) {
          bestC = c;
          best = l;
        }
      }
      if (best !== label.get(v)) {
        label.set(v, best);
        changed += 1;
      }
    }
    if (changed === 0) break;
  }
  return label;
}

/** Merge communities below `min` into the neighbour they share the most edges with (capped). */
function agglomerate(
  comm: Map<string, string>,
  adj: Map<string, Set<string>>,
  min: number,
  cap: number,
) {
  const members = () => {
    const m = new Map<string, string[]>();
    for (const [lemma, cid] of comm) (m.get(cid) ?? m.set(cid, []).get(cid)!).push(lemma);
    return m;
  };
  const frozen = new Set<string>();
  for (let guard = 0; guard < 100000; guard += 1) {
    const mem = members();
    // smallest non-frozen community that has any neighbour community
    let target: string | null = null;
    let targetSize = Infinity;
    for (const [cid, list] of mem) {
      if (frozen.has(cid) || list.length >= min) continue;
      if (list.length < targetSize) {
        targetSize = list.length;
        target = cid;
      }
    }
    if (!target) break;

    const list = mem.get(target)!;
    const weight = new Map<string, number>();
    for (const lemma of list) {
      for (const nb of adj.get(lemma) ?? []) {
        const ncid = comm.get(nb)!;
        if (ncid !== target) weight.set(ncid, (weight.get(ncid) ?? 0) + 1);
      }
    }
    let bestN: string | null = null;
    let bestW = 0;
    for (const [ncid, w] of weight) {
      if ((mem.get(ncid)?.length ?? 0) + list.length > cap) continue;
      if (w > bestW) {
        bestW = w;
        bestN = ncid;
      }
    }
    // No under-cap neighbour: a tiny community still shouldn't be left stranded —
    // merge into its most-connected neighbour and let splitLarge rebalance later.
    if (!bestN && list.length < min) {
      for (const [ncid, w] of weight) {
        if (w > bestW) {
          bestW = w;
          bestN = ncid;
        }
      }
    }
    if (!bestN) {
      frozen.add(target); // genuinely no neighbour to merge into
      continue;
    }
    for (const lemma of list) comm.set(lemma, bestN);
  }
}

/** Split any community larger than `cap` into contiguous BFS chunks near `target` size. */
function splitLarge(comm: Map<string, string>, adj: Map<string, Set<string>>, cap: number, target: number) {
  const mem = new Map<string, string[]>();
  for (const [lemma, cid] of comm) (mem.get(cid) ?? mem.set(cid, []).get(cid)!).push(lemma);
  for (const [cid, list] of mem) {
    if (list.length <= cap) continue;
    const inComm = new Set(list);
    const seen = new Set<string>();
    let piece = 0;
    for (const start of list.sort()) {
      if (seen.has(start)) continue;
      // BFS chunk of ~target from this seed
      const queue = [start];
      seen.add(start);
      const chunk: string[] = [];
      while (queue.length && chunk.length < target) {
        const v = queue.shift()!;
        chunk.push(v);
        for (const nb of adj.get(v) ?? []) {
          if (inComm.has(nb) && !seen.has(nb)) {
            seen.add(nb);
            queue.push(nb);
          }
        }
      }
      const newCid = `${cid}#${piece++}`;
      for (const v of chunk) comm.set(v, newCid);
    }
  }
}

/** Name a group after its hub: highest degree, then lowest rank. */
function hubName(members: string[], nodeOf: Map<string, Node>): string {
  let best = members[0];
  let bestScore = -Infinity;
  for (const m of members) {
    const n = nodeOf.get(m)!;
    const score = n.degree * 1000 - (n.rank ?? 9999);
    if (score > bestScore) {
      bestScore = score;
      best = m;
    }
  }
  return best;
}

async function main() {
  const records: VocabularyRecord[] = [];
  for await (const record of openNdjsonRepository().all()) records.push(record);
  const pages = records.map((record) => toGraphInput(record, { records }));

  const adj = buildAdjacency(pages);
  const nodeOf = new Map<string, Node>(
    pages.map((p) => [p.lemma, { lemma: p.lemma, degree: adj.get(p.lemma)?.size ?? 0, rank: p.memberships[0]?.rank ?? null }]),
  );

  const connected = pages.filter((p) => (adj.get(p.lemma)?.size ?? 0) > 0).map((p) => p.lemma);
  const isolated = pages.filter((p) => (adj.get(p.lemma)?.size ?? 0) === 0).map((p) => p.lemma);

  // Charts
  const comm = labelPropagation(connected, adj);
  agglomerate(comm, adj, CHART_MIN, CHART_CAP);
  splitLarge(comm, adj, CHART_CAP, CHART_TARGET);
  agglomerate(comm, adj, CHART_MIN, CHART_CAP); // mop up leftovers, avoiding stranded singletons
  // NOTE: dependency-free clustering (LP + agglomerate + BFS split) can't fully converge on
  // size — a few charts stay large. Good enough for the renderer (which just needs charts to
  // exist and be chart-scoped); replace with proper Louvain before the quiz phase, where chart
  // *semantic* quality sets difficulty.

  const chartMembers = new Map<string, string[]>();
  for (const [lemma, cid] of comm) (chartMembers.get(cid) ?? chartMembers.set(cid, []).get(cid)!).push(lemma);
  const chartName = new Map<string, string>();
  for (const [cid, list] of chartMembers) chartName.set(cid, hubName(list, nodeOf));

  // Regions: cluster the chart graph (charts adjacent if their words link)
  const chartAdj = new Map<string, Set<string>>();
  for (const p of pages) {
    const ca = comm.get(p.lemma);
    if (!ca) continue;
    for (const c of p.connections) {
      const cb = comm.get(c.target);
      if (cb && cb !== ca) {
        (chartAdj.get(ca) ?? chartAdj.set(ca, new Set()).get(ca)!).add(cb);
        (chartAdj.get(cb) ?? chartAdj.set(cb, new Set()).get(cb)!).add(ca);
      }
    }
  }
  const region = labelPropagation([...chartMembers.keys()], chartAdj);
  agglomerate(region, chartAdj, 4, REGION_CAP);
  const regionMembers = new Map<string, string[]>(); // region -> chart cids
  for (const [cid, rid] of region) (regionMembers.get(rid) ?? regionMembers.set(rid, []).get(rid)!).push(cid);
  const regionName = new Map<string, string>();
  for (const [rid, cids] of regionMembers) {
    const words = cids.flatMap((c) => chartMembers.get(c) ?? []);
    regionName.set(rid, hubName(words, nodeOf));
  }

  // Final assignment per lemma
  const assign = new Map<string, { chart: string; region: string }>();
  for (const [lemma, cid] of comm) {
    assign.set(lemma, { chart: chartName.get(cid)!, region: regionName.get(region.get(cid)!) ?? "drift" });
  }
  for (const lemma of isolated) assign.set(lemma, { chart: "drift", region: "drift" });

  // Report
  const sizes = [...chartMembers.values()].map((l) => l.length);
  const buckets = { "1": 0, "2-11": 0, "12-24": 0, "25+": 0 };
  for (const s of sizes) buckets[s === 1 ? "1" : s <= 11 ? "2-11" : s <= 24 ? "12-24" : "25+"]++;
  console.log(`Pages: ${pages.length} · connected: ${connected.length} · isolated(drift): ${isolated.length}`);
  console.log(`Charts: ${chartMembers.size} · Regions: ${regionMembers.size}`);
  console.log(`Chart size buckets: ${JSON.stringify(buckets)} · max: ${Math.max(...sizes)}`);

  if (!write) {
    console.log("\n(dry run — pass --write to update canonical NDJSON)");
    return;
  }

  const updates = records.flatMap((record) => {
    const next = assign.get(record.lemma);
    if (!next || (record.chart === next.chart && record.region === next.region)) return [];
    return [{ ...record, chart: next.chart, region: next.region }];
  });
  await writeVocabularyRecords(path.join(process.cwd(), "content", "vocabulary"), updates);
  console.log(`\nWrote chart/region to ${updates.length} canonical record(s).`);
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
