export type Vec3 = [number, number, number];
export type AssetRef = { url: string; bytes: number };

export type GalaxyChart = {
  id: string;
  name: string;
  glyph: string;
  hue: string;
  wordCount: number;
  center: Vec3;
  radius: number;
  previewSeed: number;
  neighbors: { chartId: string; weight: number }[];
  asset: AssetRef;
};

export type GalaxyManifest = {
  version: string;
  list: {
    slug: string;
    label: string;
    wordCount: number;
    chartCount: number;
    coreCount: number;
    advancedCount: number;
    driftCount: number;
  };
  charts: GalaxyChart[];
  assets: { searchIndex: AssetRef; full: AssetRef };
};

export type PositionedWord = {
  lemma: string;
  display: string;
  tier: "core" | "advanced";
  partOfSpeech: string;
  rank: number | null;
  degree: number;
  chartId: string;
  xyz: Vec3;
};

export type ShardEdge = { source: string; target: string; type: string };
export type ShardPortal = ShardEdge & { targetChart: string };
export type ChartShard = {
  version: string;
  listSlug: string;
  chartId: string;
  words: PositionedWord[];
  edges: ShardEdge[];
  portals: ShardPortal[];
};

export type SearchEntry = Omit<PositionedWord, "xyz"> & { normalized: string };
export type SearchCatalogData = { version: string; listSlug: string; entries: SearchEntry[] };
export type ChartLink = { sourceChart: string; targetChart: string; weight: number };
export type PositionedGalaxy = {
  listSlug: string;
  label: string;
  charts: Omit<GalaxyChart, "asset">[];
  words: PositionedWord[];
  edges: ShardEdge[];
  chartLinks: ChartLink[];
};

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null;

export function isGalaxyManifest(value: unknown): value is GalaxyManifest {
  if (!isRecord(value) || typeof value.version !== "string" || !isRecord(value.list) || !isRecord(value.assets)) return false;
  if (typeof value.list.slug !== "string" || typeof value.list.label !== "string") return false;
  for (const key of ["wordCount", "chartCount", "coreCount", "advancedCount", "driftCount"]) {
    if (typeof value.list[key] !== "number") return false;
  }
  if (!Array.isArray(value.charts) || !value.charts.every((chart) => isRecord(chart) && typeof chart.id === "string" && isRecord(chart.asset) && typeof chart.asset.url === "string" && typeof chart.asset.bytes === "number")) return false;
  return isRecord(value.assets.searchIndex) && typeof value.assets.searchIndex.url === "string"
    && isRecord(value.assets.full) && typeof value.assets.full.url === "string";
}

export function isChartShard(value: unknown): value is ChartShard {
  return isRecord(value) && typeof value.version === "string" && typeof value.listSlug === "string"
    && typeof value.chartId === "string" && Array.isArray(value.words)
    && Array.isArray(value.edges) && Array.isArray(value.portals);
}

export function isSearchCatalogData(value: unknown): value is SearchCatalogData {
  return isRecord(value) && typeof value.version === "string" && typeof value.listSlug === "string"
    && Array.isArray(value.entries);
}
