import { describe, expect, it } from "vitest";

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
});
