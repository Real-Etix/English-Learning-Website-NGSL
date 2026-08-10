import { describe, expect, it } from "vitest";

import { buildGalaxyArtifacts } from "../../../lib/galaxy/build-artifacts";
import { fixtureGraph } from "../../../lib/galaxy/test-fixture";
import type { GalaxyManifest } from "../../../lib/galaxy/types";

import { buildProxyLayout } from "./progressive-engine";

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
