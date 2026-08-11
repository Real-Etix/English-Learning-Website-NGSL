import { describe, expect, it } from "vitest";

import type { LiteGraph } from "@/lib/wiki/parse-wiki";
import { buildLadderRungs, buildRunStops } from "./learning-routes";

const graph: LiteGraph = {
  slug: "fixture",
  isolatedCount: 0,
  nodes: [
    { lemma: "buy", display: "buy", tier: "core", pos: "verb", rank: 10, chart: "trade", degree: 2 },
    { lemma: "purchase", display: "purchase", tier: "advanced", pos: "verb", rank: 3000, chart: "trade", degree: 2 },
    { lemma: "get", display: "get", tier: "core", pos: "verb", rank: 5, chart: "action", degree: 1 },
    { lemma: "obtain", display: "obtain", tier: "advanced", pos: "verb", rank: 2800, chart: "action", degree: 1 },
  ],
  edges: [
    { source: "buy", target: "purchase", type: "advanced_form" },
    { source: "get", target: "obtain", type: "advanced_form" },
  ],
};

describe("learning routes", () => {
  it("returns at most one deterministic run stop per chart", () => {
    const first = buildRunStops(graph, "2026-08-10", 8);
    const second = buildRunStops(graph, "2026-08-10", 8);

    expect(first).toEqual(second);
    expect(new Set(first.map((stop) => stop.chartId)).size).toBe(first.length);
  });

  it("returns ladder rungs with both chart IDs and prioritises held bases", () => {
    const rungs = buildLadderRungs(graph, new Set(["buy"]), 7);

    expect(rungs[0]).toMatchObject({
      from: "buy",
      fromChartId: expect.any(String),
      toChartId: expect.any(String),
      baseHeld: true,
    });
  });

  it("normalizes builds_on from its target to its source", () => {
    const rungs = buildLadderRungs({
      ...graph,
      edges: [{ source: "purchase", target: "buy", type: "builds_on" }],
    }, new Set(), 7);

    expect(rungs).toEqual([expect.objectContaining({ from: "buy", to: "purchase", type: "builds_on" })]);
  });

  it("excludes targets the learner already owns", () => {
    expect(buildLadderRungs(graph, new Set(["purchase"]), 7)).toEqual([
      expect.objectContaining({ to: "obtain" }),
    ]);
  });

  it("deduplicates target lemmas after scoring held bases before advanced targets and degree", () => {
    const rungs = buildLadderRungs({
      slug: "priorities",
      isolatedCount: 0,
      nodes: [
        { lemma: "held", display: "held", tier: "core", pos: "verb", rank: 1, chart: "base", degree: 1 },
        { lemma: "unheld", display: "unheld", tier: "core", pos: "verb", rank: 2, chart: "base", degree: 1 },
        { lemma: "advanced", display: "advanced", tier: "advanced", pos: "verb", rank: 3, chart: "target", degree: 1 },
        { lemma: "core", display: "core", tier: "core", pos: "verb", rank: 4, chart: "target", degree: 9 },
      ],
      edges: [
        { source: "unheld", target: "advanced", type: "advanced_form" },
        { source: "held", target: "advanced", type: "advanced_form" },
        { source: "unheld", target: "core", type: "advanced_form" },
      ],
    }, new Set(["held"]), 7);

    expect(rungs).toEqual([
      expect.objectContaining({ from: "held", to: "advanced", baseHeld: true }),
      expect.objectContaining({ from: "unheld", to: "core", baseHeld: false }),
    ]);
  });
});
