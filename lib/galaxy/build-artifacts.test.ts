import { describe, expect, it } from "vitest";

import type { LiteGraph } from "@/lib/wiki/parse-wiki";

import { buildGalaxyArtifacts } from "./build-artifacts";
import { decodeFullGalaxy } from "./full-codec";
import { fixtureGraph as graph } from "./test-fixture";

describe("buildGalaxyArtifacts", () => {
  it("builds a complete, navigable progressive-galaxy bundle", () => {
    const bundle = buildGalaxyArtifacts(graph, "Fixture");

    expect(bundle.manifest.list.wordCount).toBe(graph.nodes.length);
    expect(bundle.manifest.charts.every((chart) => chart.asset.url.includes("/generated/galaxy/assets/"))).toBe(true);
    const shardWords = bundle.chartShards.flatMap((item) => item.data.words.map((word) => word.lemma));
    expect(shardWords.sort()).toEqual(graph.nodes.map((node) => node.lemma).sort());
    expect(new Set(shardWords).size).toBe(graph.nodes.length);
    expect(bundle.search.data.entries).toHaveLength(graph.nodes.length);
    expect(decodeFullGalaxy(bundle.full.bytes.buffer.slice(bundle.full.bytes.byteOffset, bundle.full.bytes.byteOffset + bundle.full.bytes.byteLength)).words).toHaveLength(graph.nodes.length);
    expect(bundle.chartShards.find((item) => item.data.chartId === "speech")?.data.portals).toContainEqual({
      source: "talk", target: "move", targetChart: "motion", type: "collocation",
    });
    expect(bundle.chartShards.find((item) => item.data.chartId === "motion")?.data.portals).toContainEqual({
      source: "move", target: "talk", targetChart: "speech", type: "collocation",
    });
  });

  it("sorts Unicode search entries with locale-independent ordinal ordering", () => {
    const unicodeGraph = {
      ...graph,
      nodes: [
        { lemma: "aland", display: "Åland", tier: "core", pos: "noun", rank: 1, chart: "speech", degree: 0 },
        { lemma: "zulu", display: "Zulu", tier: "core", pos: "noun", rank: 2, chart: "speech", degree: 0 },
        { lemma: "aether", display: "Æther", tier: "core", pos: "noun", rank: 3, chart: "speech", degree: 0 },
      ],
      edges: [],
      isolatedCount: 3,
    } satisfies LiteGraph;

    const displays = buildGalaxyArtifacts(unicodeGraph, "Unicode Fixture")
      .search.data.entries.map((entry) => entry.display);

    expect(displays).toEqual(["Åland", "Zulu", "Æther"]);
  });
});
