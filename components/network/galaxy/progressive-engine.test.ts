import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { buildGalaxyArtifacts } from "../../../lib/galaxy/build-artifacts";
import { fixtureGraph } from "../../../lib/galaxy/test-fixture";
import type { GalaxyManifest, PositionedWord, ShardEdge } from "../../../lib/galaxy/types";

import * as progressiveEngine from "./progressive-engine";

import {
  buildProxyLayout,
  focusCameraDistance,
  planDeferredLabelChunks,
  transferAlphaStateByLemma,
  zoomLevelTransition,
} from "./progressive-engine";

const manifest = buildGalaxyArtifacts(fixtureGraph, "Fixture").manifest;

type ChartBackboneSelector = (
  edges: readonly ShardEdge[],
  words: readonly PositionedWord[],
  chartId: string,
) => ShardEdge[];

type WordLabelBudget = (
  maximum: number,
  context: { chart: boolean; focus: boolean; hover: boolean },
) => number;

function chartBackboneSelector(): ChartBackboneSelector {
  const selector = (progressiveEngine as unknown as {
    selectChartBackboneEdges?: ChartBackboneSelector;
  }).selectChartBackboneEdges;
  expect(selector).toBeTypeOf("function");
  return selector as ChartBackboneSelector;
}

function wordLabelBudget(): WordLabelBudget {
  const budget = (progressiveEngine as unknown as {
    contextualWordLabelBudget?: WordLabelBudget;
  }).contextualWordLabelBudget;
  expect(budget).toBeTypeOf("function");
  return budget as WordLabelBudget;
}

function denseChartFixture(wordCount = 575, edgeCount = 1_748): {
  words: PositionedWord[];
  edges: ShardEdge[];
} {
  const words = Array.from({ length: wordCount }, (_, index): PositionedWord => ({
    lemma: `word-${index}`,
    display: `word-${index}`,
    tier: "core",
    partOfSpeech: "unknown",
    rank: index + 1,
    degree: 6,
    chartId: "to",
    xyz: [index, index % 7, index % 11],
  }));
  const edges = Array.from({ length: edgeCount }, (_, index): ShardEdge => {
    const source = index % wordCount;
    const offset = 1 + Math.floor(index / wordCount);
    return {
      source: `word-${source}`,
      target: `word-${(source + offset) % wordCount}`,
      type: index % 5 === 0 ? "synonym" : "collocation",
    };
  });
  return { words, edges };
}

function withLargeCharts(source: GalaxyManifest): GalaxyManifest {
  return {
    ...source,
    charts: source.charts.map((chart) => ({
      ...chart,
      wordCount: chart.id === "drift" ? 48 : 240,
    })),
  };
}

describe("buildProxyLayout", () => {
  it("creates a deterministic maximum of 24 lightweight points per chart", () => {
    const large = withLargeCharts(manifest);
    const first = buildProxyLayout(large);
    const second = buildProxyLayout(large);

    expect(first).toEqual(second);
    for (const chart of large.charts) {
      expect(first.points.filter((point) => point.chartId === chart.id)).toHaveLength(24);
    }
  });

  it("scatters Drift as field stars and omits its chart label", () => {
    const large = withLargeCharts(manifest);
    const layout = buildProxyLayout(large);
    const drift = large.charts.find((chart) => chart.id === "drift")!;
    const driftPoints = layout.points.filter((point) => point.chartId === "drift");
    const furthestFromNominalCenter = Math.max(...driftPoints.map((point) => Math.hypot(
      point.xyz[0] - drift.center[0],
      point.xyz[1] - drift.center[1],
      point.xyz[2] - drift.center[2],
    )));

    expect(furthestFromNominalCenter).toBeGreaterThan(drift.radius);
    expect(layout.labelChartIds).not.toContain("drift");
    expect(layout.labelChartIds).toHaveLength(large.charts.length - 1);
  });
});

describe("transferAlphaStateByLemma", () => {
  it("preserves resident current and target alpha while new words start transparent", () => {
    const transferred = transferAlphaStateByLemma(
      ["new", "steady", "dimmed"],
      new Float32Array([1, 0.4, 0.3]),
      {
        lemmas: ["dimmed", "removed", "steady"],
        current: new Float32Array([0.14, 0.8, 0.72]),
        target: new Float32Array([0.14, 1, 0.95]),
      },
    );

    expect(transferred.current).toEqual(new Float32Array([0, 0.72, 0.14]));
    expect(transferred.target).toEqual(new Float32Array([1, 0.95, 0.14]));
  });

  it("seeds resident words when a larger full layer is constructed", () => {
    const transferred = transferAlphaStateByLemma(
      ["full-only", "resident"],
      new Float32Array([1, 1]),
      {
        lemmas: ["resident"],
        current: new Float32Array([0.61]),
        target: new Float32Array([0.9]),
      },
    );

    expect(transferred.current).toEqual(new Float32Array([0, 0.61]));
    expect(transferred.target).toEqual(new Float32Array([1, 0.9]));
  });
});

describe("focusCameraDistance", () => {
  it("restores a too-close camera before otherwise capping focus distance", () => {
    expect(focusCameraDistance(150)).toBe(190);
    expect(focusCameraDistance(200)).toBe(200);
    expect(focusCameraDistance(500)).toBe(235);
  });
});

describe("planDeferredLabelChunks", () => {
  it("splits label DOM creation into bounded batches while preserving exact totals", () => {
    const chunks = planDeferredLabelChunks(200, 44);

    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.every((chunk) => chunk.wordCount <= 12)).toBe(true);
    expect(chunks.every((chunk) => chunk.chartCount <= 4)).toBe(true);
    expect(chunks.reduce((sum, chunk) => sum + chunk.wordCount, 0)).toBe(200);
    expect(chunks.reduce((sum, chunk) => sum + chunk.chartCount, 0)).toBe(44);
  });

  it("omits empty chunks for small totals", () => {
    expect(planDeferredLabelChunks(0, 0)).toEqual([]);
    expect(planDeferredLabelChunks(3, 1)).toEqual([
      { wordStart: 0, wordCount: 3, chartStart: 0, chartCount: 1 },
    ]);
  });
});

describe("zoomLevelTransition", () => {
  it("emits the initial galaxy level once", () => {
    expect(zoomLevelTransition(null, 980)).toEqual({ level: "galaxy", changed: true });
    expect(zoomLevelTransition("galaxy", 980)).toEqual({ level: "galaxy", changed: false });
  });
});

describe("selectChartBackboneEdges", () => {
  it("reduces a 575-word dense chart to a deterministic 96-edge ceiling", () => {
    const { words, edges } = denseChartFixture();
    const select = chartBackboneSelector();

    const first = select(edges, words, "to");
    const second = select(edges, words, "to");

    expect(first).toEqual(second);
    expect(first.length).toBeGreaterThan(0);
    expect(first.length).toBeLessThanOrEqual(96);
  });

  it("spreads the resting backbone instead of letting one hub form a spoke wall", () => {
    const { words } = denseChartFixture(40, 0);
    const hubEdges: ShardEdge[] = Array.from({ length: 39 }, (_, index) => ({
      source: "word-0",
      target: `word-${index + 1}`,
      type: "collocation",
    }));
    const distributedEdges: ShardEdge[] = Array.from({ length: 39 }, (_, index) => ({
      source: `word-${index + 1}`,
      target: `word-${((index + 1) % 39) + 1}`,
      type: index % 2 === 0 ? "synonym" : "antonym",
    }));

    const result = chartBackboneSelector()(
      [...hubEdges, ...distributedEdges],
      words,
      "to",
    );
    const hubSegments = result.filter((edge) => edge.source === "word-0" || edge.target === "word-0");
    const representedWords = new Set(result.flatMap((edge) => [edge.source, edge.target]));

    expect(hubSegments.length).toBeLessThanOrEqual(4);
    expect(representedWords.size).toBeGreaterThan(20);
  });

  it("keeps every relationship visible when a small chart is already below budget", () => {
    const { words } = denseChartFixture(4, 0);
    const edges: ShardEdge[] = [
      { source: "word-0", target: "word-1", type: "builds_on" },
      { source: "word-0", target: "word-1", type: "advanced_form" },
      { source: "word-1", target: "word-2", type: "synonym" },
      { source: "word-2", target: "word-3", type: "collocation" },
    ];

    const result = chartBackboneSelector()(edges, words, "to");

    expect(result).toEqual(edges);
  });
});

describe("contextualWordLabelBudget", () => {
  it("keeps large charts quiet at rest while reserving more labels for local exploration", () => {
    const budget = wordLabelBudget();

    expect(budget(200, { chart: true, focus: false, hover: false })).toBe(36);
    expect(budget(200, { chart: true, focus: false, hover: true })).toBe(48);
    expect(budget(200, { chart: true, focus: true, hover: false })).toBe(48);
    expect(budget(64, { chart: false, focus: false, hover: false })).toBe(64);
  });
});

describe("ProgressiveStarEngine lifecycle source", () => {
  it("renders links as translucent normal-blended color instead of additive white light", () => {
    const source = readFileSync(
      new URL("./progressive-engine.ts", import.meta.url),
      "utf8",
    );
    const materialStart = source.indexOf("this.linkObject = new THREE.LineSegments");
    const materialEnd = source.indexOf("this.linkObject.frustumCulled", materialStart);
    const linkMaterial = source.slice(materialStart, materialEnd);

    expect(linkMaterial).toContain("opacity: 0.5");
    expect(linkMaterial).toContain("blending: THREE.NormalBlending");
    expect(linkMaterial).not.toContain("THREE.AdditiveBlending");
  });

  it("brightens hovered local links above the quiet chart backbone", () => {
    const source = readFileSync(
      new URL("./progressive-engine.ts", import.meta.url),
      "utf8",
    );

    expect(source).toContain("if (this.state.focus || this.state.hover) return 0.95;");
    expect(source).toContain("if (this.state.chart) return 0.58;");
  });

  it("limits resting chart labels and reveals only the hovered star's labeled neighborhood", () => {
    const source = readFileSync(
      new URL("./progressive-engine.ts", import.meta.url),
      "utf8",
    );

    expect(source).toContain("private hoverNeighbors = new Set<string>();");
    expect(source).toContain("this.refreshHoverNeighbors();");
    expect(source).toContain("neighbors: this.state.focus ? this.focusNeighbors : this.hoverNeighbors,");
    expect(source).toContain("max: contextualWordLabelBudget(this.maxWordLabels");
    expect(source).toMatch(/if \(this\.state\.hover\) return word\.lemma === this\.state\.hover \|\| this\.hoverNeighbors\.has\(word\.lemma\);/);
  });

  it("uses the bounded chart backbone at rest and rebuilds direct links on hover", () => {
    const source = readFileSync(
      new URL("./progressive-engine.ts", import.meta.url),
      "utf8",
    );

    expect(source).toContain("selectChartBackboneEdges(residentEdges, layer.words, this.state.chart)");
    expect(source).toMatch(/if \(this\.state\.hover\) return edge\.source === this\.state\.hover \|\| edge\.target === this\.state\.hover;/);
    expect(source).toMatch(/this\.state\.hover = hover;[\s\S]*?this\.refreshWordAttributes\(\);[\s\S]*?this\.rebuildLinks\(\);[\s\S]*?this\.refreshLabelAssignments\(\);/);
  });

  it("routes contextual word labels through the active quality budget instead of the hard-coded 200 count", () => {
    const source = readFileSync(
      new URL("./progressive-engine.ts", import.meta.url),
      "utf8",
    );

    expect(source).toMatch(/private maxWordLabels = MAX_WORD_LABELS;/);
    expect(source).toMatch(/max:\s*contextualWordLabelBudget\(this\.maxWordLabels/);
    expect(source).toMatch(/this\.maxWordLabels\s*=\s*clampWordLabelBudget\(profile\.maxWordLabels\);/);
  });

  it("avoids rendering an empty claim-ring layer", () => {
    const source = readFileSync(
      new URL("./progressive-engine.ts", import.meta.url),
      "utf8",
    );

    expect(source).toMatch(/layer\.rings\.visible\s*=\s*hasVisibleRingData\(layer\);/);
    expect(source).toContain("function hasVisibleRingData");
  });

  it("projects only assigned word labels on each frame", () => {
    const source = readFileSync(
      new URL("./progressive-engine.ts", import.meta.url),
      "utf8",
    );

    expect(source).toContain("const labelCount = Math.min(this.labelWords.length, this.labelElements.length);");
    expect(source).toContain("labelIndex < labelCount");
  });

  it("marks renderer-visible on the first renderer frame while keeping the preview handoff callback", () => {
    const source = readFileSync(
      new URL("./progressive-engine.ts", import.meta.url),
      "utf8",
    );

    expect(source).toContain("markGalaxyRendererVisible()");
    expect(source).toContain("this.options.onConstellationVisible?.()");
    expect(source).not.toContain("markGalaxyConstellationVisible();");
  });
});
