import { describe, expect, it } from "vitest";

import type { LiteGraph } from "@/lib/wiki/parse-wiki";

import { buildGalaxyArtifacts } from "./build-artifacts";
import { compactGalaxyManifestForClient } from "./client-manifest";

describe("compactGalaxyManifestForClient", () => {
  it("preserves startup-critical manifest fields while trimming chart adjacency to one strongest neighbour", () => {
    const graph = {
      slug: "compact-client-manifest",
      nodes: [
        { lemma: "alpha", display: "Alpha", tier: "core", pos: "noun", rank: 1, chart: "anchor", degree: 3 },
        { lemma: "atlas", display: "Atlas", tier: "core", pos: "noun", rank: 2, chart: "anchor", degree: 2 },
        { lemma: "beta", display: "Beta", tier: "core", pos: "noun", rank: 3, chart: "branch-a", degree: 2 },
        { lemma: "bloom", display: "Bloom", tier: "core", pos: "noun", rank: 4, chart: "branch-a", degree: 1 },
        { lemma: "gamma", display: "Gamma", tier: "advanced", pos: "noun", rank: 5, chart: "branch-b", degree: 1 },
        { lemma: "glow", display: "Glow", tier: "advanced", pos: "noun", rank: 6, chart: "branch-b", degree: 1 },
      ],
      edges: [
        { source: "alpha", target: "beta", type: "collocation" },
        { source: "atlas", target: "beta", type: "collocation" },
        { source: "alpha", target: "gamma", type: "collocation" },
      ],
      isolatedCount: 0,
    } satisfies LiteGraph;
    const manifest = buildGalaxyArtifacts(graph, "Compact Fixture").manifest;
    const multiNeighborChart = manifest.charts.find((chart) => chart.id === "anchor");
    expect(multiNeighborChart?.neighbors.length).toBe(2);

    const compact = compactGalaxyManifestForClient(manifest);

    expect(compact).not.toBe(manifest);
    expect(compact.version).toBe(manifest.version);
    expect(compact.list).toEqual(manifest.list);
    expect(compact.assets).toEqual(manifest.assets);
    expect(compact.charts).toHaveLength(manifest.charts.length);

    for (const chart of manifest.charts) {
      const compactChart = compact.charts.find((candidate) => candidate.id === chart.id);
      expect(compactChart).toEqual({
        id: chart.id,
        name: chart.name,
        glyph: chart.glyph,
        hue: chart.hue,
        wordCount: chart.wordCount,
        center: chart.center,
        radius: chart.radius,
        previewSeed: chart.previewSeed,
        neighbors: chart.neighbors.length === 0
          ? []
          : [chart.neighbors.toSorted((left, right) => right.weight - left.weight || left.chartId.localeCompare(right.chartId))[0]],
        asset: chart.asset,
      });
    }

    expect(manifest.charts.find((chart) => chart.id === "anchor")?.neighbors).toEqual(multiNeighborChart?.neighbors);
  });
});
