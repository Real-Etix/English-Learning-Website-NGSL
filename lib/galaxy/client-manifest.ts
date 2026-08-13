import type { GalaxyChart, GalaxyManifest } from "./types";

function strongestNeighbor(chart: GalaxyChart): GalaxyChart["neighbors"] {
  if (chart.neighbors.length === 0) return [];
  return [chart.neighbors.toSorted((left, right) => right.weight - left.weight || left.chartId.localeCompare(right.chartId))[0]];
}

/**
 * Reduce the RSC/client payload to the fields the startup shell and mounted
 * atlas actually need. Generated manifests on disk stay untouched; this helper
 * only compacts the server-to-client copy passed through the page boundary.
 */
export function compactGalaxyManifestForClient(manifest: GalaxyManifest): GalaxyManifest {
  return {
    version: manifest.version,
    list: { ...manifest.list },
    charts: manifest.charts.map((chart) => ({
      id: chart.id,
      name: chart.name,
      glyph: chart.glyph,
      hue: chart.hue,
      wordCount: chart.wordCount,
      center: [...chart.center] as GalaxyChart["center"],
      radius: chart.radius,
      previewSeed: chart.previewSeed,
      neighbors: strongestNeighbor(chart),
      asset: { ...chart.asset },
    })),
    assets: {
      searchIndex: { ...manifest.assets.searchIndex },
      full: { ...manifest.assets.full },
    },
  };
}
