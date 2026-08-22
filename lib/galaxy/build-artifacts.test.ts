import { describe, expect, it } from "vitest";

import type { LiteGraph } from "@/lib/vocabulary/graph";

import { buildGalaxyArtifacts } from "./build-artifacts";
import { decodeFullGalaxy } from "./full-codec";
import { layoutGalaxy } from "./layout";
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

  it("keeps Unicode layout and complete artifacts stable across host collations", () => {
    const unicodeGraph = {
      slug: "unicode-charts",
      nodes: [
        { lemma: "zebra", display: "Zebra", tier: "core", pos: "noun", rank: 1, chart: "zulu", degree: 1 },
        { lemma: "æon", display: "Æon", tier: "core", pos: "noun", rank: 2, chart: "zulu", degree: 1 },
        { lemma: "alpha", display: "Alpha", tier: "core", pos: "noun", rank: 3, chart: "äther", degree: 1 },
        { lemma: "åke", display: "Åke", tier: "core", pos: "noun", rank: 4, chart: "äther", degree: 1 },
        { lemma: "omega", display: "Omega", tier: "core", pos: "noun", rank: 5, chart: "øzone", degree: 1 },
        { lemma: "über", display: "Über", tier: "core", pos: "noun", rank: 6, chart: "øzone", degree: 1 },
      ],
      edges: [
        { source: "zebra", target: "omega", type: "collocation" },
        { source: "alpha", target: "über", type: "collocation" },
      ],
      isolatedCount: 0,
    } satisfies LiteGraph;
    const buildWithLocale = (locale: string) => {
      const originalLocaleCompare = String.prototype.localeCompare;
      const collator = new Intl.Collator(locale);
      String.prototype.localeCompare = function localeCompare(value: string): number {
        return collator.compare(String(this), value);
      };
      try {
        return {
          layout: layoutGalaxy(unicodeGraph, "Unicode Charts"),
          bundle: buildGalaxyArtifacts(unicodeGraph, "Unicode Charts"),
        };
      } finally {
        String.prototype.localeCompare = originalLocaleCompare;
      }
    };

    const english = buildWithLocale("en-US");
    const swedish = buildWithLocale("sv-SE");

    expect(english).toEqual(swedish);
    expect(english.layout.charts.map((chart) => chart.id)).toEqual(["zulu", "äther", "øzone"]);
    expect(english.layout.words.map((word) => word.lemma)).toEqual(["zebra", "æon", "alpha", "åke", "omega", "über"]);
    expect(english.layout.chartLinks.map((link) => link.sourceChart)).toEqual(["zulu", "äther"]);
    expect(english.layout.charts.find((chart) => chart.id === "øzone")?.neighbors.map((neighbor) => neighbor.chartId)).toEqual(["zulu", "äther"]);
  });
});
