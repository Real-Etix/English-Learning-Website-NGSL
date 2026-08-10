import { createHash } from "node:crypto";

import type { LiteGraph } from "@/lib/wiki/parse-wiki";

import { encodeFullGalaxy } from "./full-codec";
import { layoutGalaxy } from "./layout";
import type { AssetRef, ChartShard, GalaxyManifest, SearchCatalogData, ShardEdge } from "./types";

export type GalaxyArtifactBundle = {
  manifest: GalaxyManifest;
  chartShards: { fileName: string; bytes: Uint8Array; data: ChartShard }[];
  search: { fileName: string; bytes: Uint8Array; data: SearchCatalogData };
  full: { fileName: string; bytes: Uint8Array };
};

const encoder = new TextEncoder();

export function normalizeGalaxySearch(value: string): string {
  return value.normalize("NFKD").replace(/\p{M}/gu, "").trim().toLowerCase().replace(/\s+/g, " ");
}

function compareOrdinal(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function hashBytes(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function makeAsset(listSlug: string, kind: string, extension: string, bytes: Uint8Array): { fileName: string; asset: AssetRef } {
  const fileName = `${listSlug}-${kind}-${hashBytes(bytes).slice(0, 12)}.${extension}`;
  return {
    fileName,
    asset: { url: `/generated/galaxy/assets/${fileName}`, bytes: bytes.byteLength },
  };
}

export function buildGalaxyArtifacts(graph: LiteGraph, label: string): GalaxyArtifactBundle {
  const positioned = layoutGalaxy(graph, label);
  const version = createHash("sha256").update(JSON.stringify(graph)).digest("hex").slice(0, 16);
  const chartByWord = new Map(positioned.words.map((word) => [word.lemma, word.chartId]));
  const shards = new Map(positioned.charts.map((chart) => [chart.id, {
    version,
    listSlug: positioned.listSlug,
    chartId: chart.id,
    words: positioned.words.filter((word) => word.chartId === chart.id),
    edges: [] as ShardEdge[],
    portals: [] as ChartShard["portals"],
  }]));

  for (const edge of positioned.edges) {
    const sourceChart = chartByWord.get(edge.source);
    const targetChart = chartByWord.get(edge.target);
    if (!sourceChart || !targetChart) continue;
    if (sourceChart === targetChart) {
      shards.get(sourceChart)?.edges.push(edge);
      continue;
    }
    shards.get(sourceChart)?.portals.push({ ...edge, targetChart });
    shards.get(targetChart)?.portals.push({
      source: edge.target,
      target: edge.source,
      targetChart: sourceChart,
      type: edge.type,
    });
  }

  const chartShards = positioned.charts.map((chart) => {
    const data = shards.get(chart.id) as ChartShard;
    const bytes = encoder.encode(JSON.stringify(data));
    return { ...makeAsset(positioned.listSlug, "chart", "json", bytes), bytes, data };
  });
  const chartAssets = new Map(chartShards.map((shard, index) => [positioned.charts[index].id, shard.asset]));

  const searchData: SearchCatalogData = {
    version,
    listSlug: positioned.listSlug,
    entries: positioned.words.map(({ xyz: _xyz, ...word }) => ({ ...word, normalized: normalizeGalaxySearch(word.display) }))
      .sort((a, b) => compareOrdinal(a.normalized, b.normalized) || compareOrdinal(a.lemma, b.lemma)),
  };
  const searchBytes = encoder.encode(JSON.stringify(searchData));
  const searchAsset = makeAsset(positioned.listSlug, "search", "json", searchBytes);

  const fullBytes = encodeFullGalaxy({
    version,
    listSlug: positioned.listSlug,
    words: positioned.words.map((word) => ({
      lemma: word.lemma,
      display: word.display,
      chartId: word.chartId,
      partOfSpeech: word.partOfSpeech,
    })),
    positions: new Float32Array(positioned.words.flatMap((word) => word.xyz)),
    tiers: new Uint8Array(positioned.words.map((word) => word.tier === "core" ? 0 : 1)),
    ranks: new Int32Array(positioned.words.map((word) => word.rank ?? -1)),
    degrees: new Uint16Array(positioned.words.map((word) => word.degree)),
  });
  const fullAsset = makeAsset(positioned.listSlug, "full", "bin", fullBytes);

  return {
    manifest: {
      version,
      list: {
        slug: positioned.listSlug,
        label: positioned.label,
        wordCount: positioned.words.length,
        chartCount: positioned.charts.filter((chart) => chart.id !== "drift").length,
        coreCount: positioned.words.filter((word) => word.tier === "core").length,
        advancedCount: positioned.words.filter((word) => word.tier === "advanced").length,
        driftCount: positioned.words.filter((word) => word.chartId === "drift").length,
      },
      charts: positioned.charts.map((chart) => ({ ...chart, asset: chartAssets.get(chart.id) as AssetRef })),
      assets: { searchIndex: searchAsset.asset, full: fullAsset.asset },
    },
    chartShards: chartShards.map(({ asset: _asset, ...shard }) => shard),
    search: { fileName: searchAsset.fileName, bytes: searchBytes, data: searchData },
    full: { fileName: fullAsset.fileName, bytes: fullBytes },
  };
}
