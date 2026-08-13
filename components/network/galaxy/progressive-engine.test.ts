import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { buildGalaxyArtifacts } from "../../../lib/galaxy/build-artifacts";
import { fixtureGraph } from "../../../lib/galaxy/test-fixture";
import type { GalaxyManifest } from "../../../lib/galaxy/types";

import {
  buildProxyLayout,
  focusCameraDistance,
  planDeferredLabelChunks,
  transferAlphaStateByLemma,
  zoomLevelTransition,
} from "./progressive-engine";

const manifest = buildGalaxyArtifacts(fixtureGraph, "Fixture").manifest;

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

describe("ProgressiveStarEngine lifecycle source", () => {
  it("routes contextual word labels through the active quality budget instead of the hard-coded 200 count", () => {
    const source = readFileSync(
      new URL("./progressive-engine.ts", import.meta.url),
      "utf8",
    );

    expect(source).toMatch(/private maxWordLabels = MAX_WORD_LABELS;/);
    expect(source).toMatch(/max:\s*this\.maxWordLabels/);
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
