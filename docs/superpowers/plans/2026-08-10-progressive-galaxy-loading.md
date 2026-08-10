# Progressive Galaxy Loading Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace whole-graph startup with an immediate chart-constellation overview, progressively load real chart stars, and offer an explicit warned full-list mode.

**Architecture:** Generate immutable chart shards, a lazy search catalog, and a compact full-list binary from the existing wiki-derived graphs. Pass only a small manifest through the Next.js server page, render precomputed positions through a progressive Three.js engine, and keep data loading, scene state, product UI, and fallbacks behind separate interfaces.

**Tech Stack:** Next.js 16.2 App Router, React 19.2, TypeScript 5, Three.js 0.185, Vitest 4, Node `crypto`/`fs`, Web Workers, Playwright Chromium.

## Global Constraints

- The wiki markdown and its typed `[[wiki-links]]` remain the source of truth; generated assets are disposable derivatives.
- Normal opening shows every chart constellation but does not fetch every real word.
- Mid-range mobile target: first constellation within 2 seconds, interaction within 3 seconds, and sustained 30 FPS on simulated 4G.
- Normal-list manifests must be at most 100 KB compressed; All Words may be at most 150 KB compressed.
- No browser-side force layout or 90-pass relaxation is allowed; all real star positions are frozen at build time.
- Picking remains screen-space based; do not replace it with Three.js raycasting.
- The renderer may create at most 200 recyclable word-label DOM nodes.
- Search must find every word without downloading the full-list asset.
- Full-list mode always means the currently selected list; All Words is the only 12,115-star option.
- Full-list mode shows every star but only bounded contextual edges, never every edge simultaneously.
- Full-list mode requires a warning, exact count, byte estimate, progress, cancellation, cleanup, and a return-to-constellation action.
- Full-list mode is not restored after navigation or reload.
- Keep Chart, Run, Ladder, collection highlighting, details, quizzes, composition, and tutor behaviour working.
- Respect `prefers-reduced-motion`; all essential navigation must also work through search and chart controls.
- Supported browsers follow Next.js 16 defaults: Chrome/Edge/Firefox 111+ and Safari 16.4+.
- Do not fabricate dictionary, wiki, graph, tutor, or grading data on failure.
- Follow the repository rule to consult `node_modules/next/dist/docs/` before changing Next.js boundaries; the relevant Server/Client Components, lazy-loading, public-pages, browser-support, and accessibility guides were reviewed for this plan.

---

## File and Responsibility Map

### Build-time domain

- Create `lib/galaxy/types.ts`: shared manifest, shard, search, and full-binary types plus lightweight guards.
- Create `lib/galaxy/layout.ts`: deterministic chart centres, chart-local word positions, drift positions, and aggregate chart links.
- Create `lib/galaxy/full-codec.ts`: browser-safe binary encoder/decoder and byte-layout helpers.
- Create `lib/galaxy/build-artifacts.ts`: convert one `LiteGraph` into manifest plus immutable assets.
- Create `scripts/build-galaxy-assets.ts`: write all six lists into `public/generated/galaxy/`.
- Modify `scripts/build-graph-data.ts` only where shared list metadata is needed; it remains the wiki-to-graph step.
- Modify `package.json`: make `build:graphs` generate both graph and progressive assets.
- Modify `next.config.ts`: immutable cache headers for hashed assets, not manifests.

### Server boundary

- Create `lib/galaxy/manifest-store.ts`: read and cache the small per-list manifest.
- Modify `app/network/[listSlug]/page.tsx`: pass `GalaxyManifest`, never `LiteGraph`, to the client.
- Create `app/network/[listSlug]/error.tsx`: retryable route failure UI.
- Modify `app/api/run/route.ts`: return route stops with chart IDs while preserving `route` during migration.
- Create `app/api/ladder/route.ts`: return bounded ladder rungs with source/target chart IDs.
- Create `lib/galaxy/learning-routes.ts`: pure deterministic Run/Ladder selection.

### Client data and rendering

- Create `components/network/galaxy/asset-client.ts`: fetch/version/error primitives and streamed byte download.
- Create `components/network/galaxy/chart-shard-store.ts`: bounded concurrency, request deduplication, cancellation, and LRU residency.
- Create `components/network/galaxy/search-catalog.ts`: lazy catalog loading and exact/prefix/fuzzy lookup.
- Create `components/network/galaxy/scene-model.ts`: pure resident/full scene state used by the renderer.
- Create `components/network/galaxy/progressive-engine.ts`: precomputed-layout Three.js renderer.
- Create `components/network/galaxy/quality.ts`: initial quality profile and measured degradation.
- Create `components/network/galaxy/full-decoder.worker.ts`: validate/decode the full binary off the main thread.
- Create `components/network/galaxy/full-galaxy-loader.ts`: streamed full-mode download, worker lifecycle, and abort cleanup.
- Create `components/network/galaxy/fallback-constellation.tsx`: keyboard-operable SVG fallback.
- Create `components/network/galaxy/galaxy-controller.ts`: chart/search/focus/proximity orchestration independent of React.
- Create `components/network/star-atlas-entry.tsx`: client-only dynamic import boundary for Three.js.
- Create `components/network/full-galaxy-dialog.tsx`: accessible warning and progress dialog.
- Modify `components/network/star-atlas.tsx`: consume the manifest/controller instead of the whole graph.

### Verification and documentation

- Add focused `*.test.ts` files beside each pure module.
- Create `playwright.config.ts` and `tests/e2e/galaxy-progressive.spec.ts`.
- Create `tests/e2e/galaxy-performance.spec.ts` for request, DOM, timing, and full-count assertions.
- Modify `README.md` to describe progressive artifacts and remove stale renderer claims.
- Delete `components/network/galaxy/atlas.ts` and the old `components/network/galaxy/engine.ts` only after the new route passes all tests.

---

### Task 1: Deterministic Galaxy Types and Layout

**Files:**
- Create: `lib/galaxy/types.ts`
- Create: `lib/galaxy/layout.ts`
- Create: `lib/galaxy/test-fixture.ts`
- Test: `lib/galaxy/layout.test.ts`

**Interfaces:**
- Consumes: `LiteGraph`, `GraphNode`, and `GraphEdge` from `lib/wiki/parse-wiki.ts`.
- Produces: `GalaxyManifest`, `GalaxyChart`, `ChartShard`, `SearchEntry`, `PositionedWord`, `PositionedGalaxy`, `layoutGalaxy(graph, label)`, and `hashSeed(value)`.

- [ ] **Step 1: Write the failing deterministic-layout tests**

Create the shared fixture used by later galaxy tests in `lib/galaxy/test-fixture.ts`:

```ts
import type { LiteGraph } from "@/lib/wiki/parse-wiki";

export const fixtureGraph: LiteGraph = {
  slug: "fixture",
  isolatedCount: 1,
  chartNames: { speech: "Speaking & Listening", motion: "Movement" },
  nodes: [
    { lemma: "speak", display: "speak", tier: "core", pos: "verb", rank: 10, chart: "speech", degree: 2 },
    { lemma: "talk", display: "talk", tier: "core", pos: "verb", rank: 20, chart: "speech", degree: 1 },
    { lemma: "move", display: "move", tier: "core", pos: "verb", rank: 30, chart: "motion", degree: 1 },
    { lemma: "zebra", display: "zebra", tier: "core", pos: "noun", rank: 40, chart: "drift", degree: 0 },
  ],
  edges: [
    { source: "speak", target: "talk", type: "synonym" },
    { source: "talk", target: "move", type: "collocation" },
  ],
};
```

Then add `lib/galaxy/layout.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import { layoutGalaxy } from "./layout";
import { fixtureGraph as graph } from "./test-fixture";

describe("layoutGalaxy", () => {
  it("is deterministic and includes every word exactly once", () => {
    const a = layoutGalaxy(graph, "Fixture");
    const b = layoutGalaxy(graph, "Fixture");
    expect(a).toEqual(b);
    expect(a.words.map((word) => word.lemma).sort()).toEqual(["move", "speak", "talk", "zebra"]);
    expect(new Set(a.words.map((word) => word.lemma)).size).toBe(graph.nodes.length);
  });

  it("keeps drift visible and aggregates cross-chart links", () => {
    const result = layoutGalaxy(graph, "Fixture");
    expect(result.words.find((word) => word.lemma === "zebra")?.chartId).toBe("drift");
    expect(result.chartLinks).toContainEqual({ sourceChart: "motion", targetChart: "speech", weight: 1 });
  });

  it("uses themed names and finite frozen coordinates", () => {
    const result = layoutGalaxy(graph, "Fixture");
    expect(result.charts.find((chart) => chart.id === "speech")?.name).toBe("Speaking & Listening");
    for (const word of result.words) expect(word.xyz.every(Number.isFinite)).toBe(true);
  });
});
```

- [ ] **Step 2: Run the test and confirm the missing module failure**

Run: `npx vitest run lib/galaxy/layout.test.ts`

Expected: FAIL because `lib/galaxy/layout.ts` does not exist.

- [ ] **Step 3: Define the shared data contracts**

Add exact serializable contracts to `lib/galaxy/types.ts`:

```ts
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
```

The guards validate transport shape without walking every nested word field during animation. Artifact invariant tests provide the deep build-time validation.

- [ ] **Step 4: Implement deterministic build-time layout**

In `lib/galaxy/layout.ts`, use these exact rules:

```ts
import type { LiteGraph } from "@/lib/wiki/parse-wiki";
import type { ChartLink, PositionedGalaxy, PositionedWord, Vec3 } from "./types";

const GLYPHS = ["≈", "|", "⌐", "∧", "✦", "◦", "◇", "○", "▲", "↑", "◆", "✳", "⌕", "∴", "⋄", "✧"];
const HUES = ["#9FD4E8", "#E8C79F", "#C9B8E8", "#A8DCC0", "#E8A89F", "#E8DFA0", "#9FC4E8", "#D6BFE8"];
const GOLDEN_ANGLE = 2.39996;
const GALAXY_RADIUS = 470;

export function hashSeed(value: string): number {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function random(seed: number) {
  let state = seed >>> 0;
  return () => {
    state += 0x6d2b79f5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

const titleCase = (value: string) => value.charAt(0).toUpperCase() + value.slice(1);
const normalize = ([x, y, z]: Vec3): Vec3 => {
  const length = Math.hypot(x, y, z) || 1;
  return [x / length, y / length, z / length];
};
const cross = (a: Vec3, b: Vec3): Vec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];

export function layoutGalaxy(graph: LiteGraph, label: string): PositionedGalaxy {
  const groups = new Map<string, typeof graph.nodes>();
  for (const node of graph.nodes) {
    const chartId = node.chart || "drift";
    groups.set(chartId, [...(groups.get(chartId) || []), node]);
  }
  const chartIds = [...groups.keys()].sort((a, b) => {
    if (a === "drift") return 1;
    if (b === "drift") return -1;
    return (groups.get(b)?.length || 0) - (groups.get(a)?.length || 0) || a.localeCompare(b);
  });
  const centers = new Map<string, Vec3>();
  const charts = chartIds.map((id, index) => {
    const y = 1 - (index / Math.max(1, chartIds.length - 1)) * 1.55 - 0.22;
    const radial = Math.sqrt(Math.max(0.02, 1 - y * y));
    const theta = index * GOLDEN_ANGLE;
    const center: Vec3 = [Math.cos(theta) * radial * GALAXY_RADIUS, y * 0.72 * GALAXY_RADIUS, Math.sin(theta) * radial * GALAXY_RADIUS];
    centers.set(id, center);
    const seed = hashSeed(`${graph.slug}:${id}`);
    return {
      id,
      name: id === "drift" ? "Drift" : graph.chartNames?.[id] || titleCase(id),
      glyph: GLYPHS[seed % GLYPHS.length],
      hue: HUES[seed % HUES.length],
      wordCount: groups.get(id)?.length || 0,
      center,
      radius: id === "drift" ? GALAXY_RADIUS * 1.2 : 156,
      previewSeed: seed,
      neighbors: [] as { chartId: string; weight: number }[],
    };
  });
  const words: PositionedWord[] = [];
  for (const chartId of chartIds) {
    const members = [...(groups.get(chartId) || [])].sort((a, b) => b.degree - a.degree || a.lemma.localeCompare(b.lemma));
    const rnd = random(hashSeed(`${graph.slug}:${chartId}:words`));
    const center = centers.get(chartId) as Vec3;
    const axis = normalize(center);
    let u = normalize(cross([0, 1, 0], axis));
    if (Math.hypot(...u) < 0.01) u = [1, 0, 0];
    const v = normalize(cross(axis, u));
    members.forEach((node, index) => {
      let xyz: Vec3;
      if (chartId === "drift") {
        const driftY = rnd() * 2 - 1;
        const driftR = Math.sqrt(Math.max(0, 1 - driftY * driftY));
        const angle = rnd() * Math.PI * 2;
        const radius = GALAXY_RADIUS * (1.02 + (rnd() - 0.5) * 0.34);
        xyz = [Math.cos(angle) * driftR * radius, driftY * 0.72 * radius, Math.sin(angle) * driftR * radius];
      } else {
        const t = (index + 0.5) / Math.max(1, members.length);
        const radius = 34 + Math.sqrt(t) * 122;
        const angle = index * GOLDEN_ANGLE + rnd() * 0.35;
        const lift = (rnd() - 0.5) * 62;
        xyz = [
          center[0] + u[0] * Math.cos(angle) * radius + v[0] * Math.sin(angle) * radius + axis[0] * lift,
          center[1] + u[1] * Math.cos(angle) * radius + v[1] * Math.sin(angle) * radius + axis[1] * lift,
          center[2] + u[2] * Math.cos(angle) * radius + v[2] * Math.sin(angle) * radius + axis[2] * lift,
        ];
      }
      words.push({
        lemma: node.lemma,
        display: node.display,
        tier: node.tier,
        partOfSpeech: node.pos,
        rank: node.rank,
        degree: node.degree,
        chartId,
        xyz,
      });
    });
  }
  const chartOf = new Map(words.map((word) => [word.lemma, word.chartId]));
  const weights = new Map<string, number>();
  for (const edge of graph.edges) {
    const a = chartOf.get(edge.source);
    const b = chartOf.get(edge.target);
    if (!a || !b || a === b) continue;
    const [sourceChart, targetChart] = [a, b].sort();
    const key = `${sourceChart}\u0000${targetChart}`;
    weights.set(key, (weights.get(key) || 0) + 1);
  }
  const chartLinks: ChartLink[] = [...weights].map(([key, weight]) => {
    const [sourceChart, targetChart] = key.split("\u0000");
    return { sourceChart, targetChart, weight };
  }).sort((a, b) => b.weight - a.weight || a.sourceChart.localeCompare(b.sourceChart));
  for (const chart of charts) {
    chart.neighbors = chartLinks
      .filter((link) => link.sourceChart === chart.id || link.targetChart === chart.id)
      .map((link) => ({ chartId: link.sourceChart === chart.id ? link.targetChart : link.sourceChart, weight: link.weight }))
      .sort((a, b) => b.weight - a.weight || a.chartId.localeCompare(b.chartId))
      .slice(0, 8);
  }
  return { listSlug: graph.slug, label, charts, words, edges: graph.edges, chartLinks };
}
```

Keep relaxation build-time and chart-local if visual inspection proves the golden-angle placement overlaps; never add a browser relaxation pass. Add the chart-local overlap assertion before adding that pass.

- [ ] **Step 5: Run focused and existing graph tests**

Run: `npx vitest run lib/galaxy/layout.test.ts lib/wiki/parse-wiki.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit the layout contract**

```bash
git add lib/galaxy/types.ts lib/galaxy/layout.ts lib/galaxy/test-fixture.ts lib/galaxy/layout.test.ts
git commit -m "feat: add deterministic galaxy layout"
```

---

### Task 2: Shards, Search Catalog, and Full Binary

**Files:**
- Create: `lib/galaxy/full-codec.ts`
- Create: `lib/galaxy/full-codec.test.ts`
- Create: `lib/galaxy/build-artifacts.ts`
- Create: `lib/galaxy/build-artifacts.test.ts`

**Interfaces:**
- Consumes: `PositionedGalaxy` from Task 1.
- Produces: `encodeFullGalaxy(data)`, `decodeFullGalaxy(buffer)`, `buildGalaxyArtifacts(graph, label)`, `GalaxyArtifactBundle`, and content-hashed asset references.

- [ ] **Step 1: Write failing codec and artifact-invariant tests**

```ts
import { describe, expect, it } from "vitest";

import { decodeFullGalaxy, encodeFullGalaxy } from "./full-codec";

describe("full galaxy codec", () => {
  it("round-trips metadata and typed values", () => {
    const bytes = encodeFullGalaxy({
      version: "abc123",
      listSlug: "ngsl",
      words: [{ lemma: "speak", display: "speak", chartId: "speech", partOfSpeech: "verb" }],
      positions: new Float32Array([1.25, -2.5, 3.75]),
      tiers: new Uint8Array([0]),
      ranks: new Int32Array([10]),
      degrees: new Uint16Array([7]),
    });
    const decoded = decodeFullGalaxy(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
    expect(decoded.version).toBe("abc123");
    expect(decoded.words[0]).toEqual({ lemma: "speak", display: "speak", chartId: "speech", partOfSpeech: "verb" });
    expect([...decoded.positions]).toEqual([1.25, -2.5, 3.75]);
    expect([...decoded.ranks]).toEqual([10]);
  });

  it("rejects bad magic and truncated payloads", () => {
    expect(() => decodeFullGalaxy(new Uint8Array([0, 1, 2, 3]).buffer)).toThrow(/full galaxy/i);
  });
});
```

In `lib/galaxy/build-artifacts.test.ts`, reuse the Task 1 fixture and assert:

```ts
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
```

- [ ] **Step 2: Run the tests and confirm missing exports**

Run: `npx vitest run lib/galaxy/full-codec.test.ts lib/galaxy/build-artifacts.test.ts`

Expected: FAIL because the codec and builder do not exist.

- [ ] **Step 3: Implement the aligned `SAT1` binary format**

Use a four-byte `SAT1` magic, a little-endian `uint32` JSON-header length, four-byte alignment, then positions (`Float32 × 3N`), tiers (`Uint8 × N`), ranks (`Int32 × N`, `-1` for null), and degrees (`Uint16 × N`). Export this exact shape:

```ts
export type FullGalaxyData = {
  version: string;
  listSlug: string;
  words: { lemma: string; display: string; chartId: string; partOfSpeech: string }[];
  positions: Float32Array;
  tiers: Uint8Array;
  ranks: Int32Array;
  degrees: Uint16Array;
};

const align4 = (value: number) => (value + 3) & ~3;
const MAGIC = [0x53, 0x41, 0x54, 0x31] as const;
```

Both functions must validate `positions.length === words.length * 3` and every scalar array length equals `words.length`. The decoder must bounds-check every computed offset before constructing typed views and must throw `Invalid full galaxy payload` for any malformed input.

- [ ] **Step 4: Implement pure artifact construction**

`buildGalaxyArtifacts` must:

1. Call `layoutGalaxy`.
2. Compute `version = sha256(JSON.stringify(graph)).slice(0, 16)`.
3. Create one `ChartShard` per chart with internal edges and mirrored portals in both endpoint charts so navigation remains bidirectional.
4. Create search entries sorted by normalized display, then lemma.
5. Encode one full binary without edges or definitions.
6. Hash each asset's bytes and assign URLs such as `/generated/galaxy/assets/ngsl-chart-a1b2c3d4e5f6.json`.
7. Put each chart asset URL and byte count directly in its manifest chart.

Use this exported result so the script and tests share exactly one implementation:

```ts
export type GalaxyArtifactBundle = {
  manifest: GalaxyManifest;
  chartShards: { fileName: string; bytes: Uint8Array; data: ChartShard }[];
  search: { fileName: string; bytes: Uint8Array; data: SearchCatalogData };
  full: { fileName: string; bytes: Uint8Array };
};

export function normalizeGalaxySearch(value: string): string {
  return value.normalize("NFKD").replace(/\p{M}/gu, "").trim().toLowerCase().replace(/\s+/g, " ");
}
```

The manifest list counts come from the positioned words; Drift is a real chart asset but is excluded from `chartCount` and included in `driftCount`.

- [ ] **Step 5: Run codec, artifact, and layout tests**

Run: `npx vitest run lib/galaxy/full-codec.test.ts lib/galaxy/build-artifacts.test.ts lib/galaxy/layout.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit artifact construction**

```bash
git add lib/galaxy/full-codec.ts lib/galaxy/full-codec.test.ts lib/galaxy/build-artifacts.ts lib/galaxy/build-artifacts.test.ts
git commit -m "feat: build progressive galaxy artifacts"
```

---

### Task 3: Generate and Serve Versioned Assets

**Files:**
- Create: `scripts/build-galaxy-assets.ts`
- Create: `lib/galaxy/manifest-store.ts`
- Create: `lib/galaxy/manifest-store.test.ts`
- Modify: `package.json`
- Modify: `next.config.ts`
- Generate: `public/generated/galaxy/manifests/*.json`
- Generate: `public/generated/galaxy/assets/*.{json,bin}`

**Interfaces:**
- Consumes: `data/generated/graphs/{slug}.json` and `buildGalaxyArtifacts`.
- Produces: `loadGalaxyManifest(slug): Promise<GalaxyManifest>` and immutable public assets for six list routes.

- [ ] **Step 1: Write the failing manifest-store test**

```ts
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { buildGalaxyArtifacts } from "./build-artifacts";
import { loadGalaxyManifestFrom } from "./manifest-store";
import { fixtureGraph } from "./test-fixture";

describe("manifest store", () => {
  it("reads a generated manifest and rejects unsafe slugs", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "galaxy-manifest-"));
    await mkdir(path.join(root, "manifests"));
    const manifest = buildGalaxyArtifacts({ ...fixtureGraph, slug: "ngsl" }, "NGSL").manifest;
    await writeFile(path.join(root, "manifests", "ngsl.json"), JSON.stringify(manifest));
    await expect(loadGalaxyManifestFrom("ngsl", root)).resolves.toMatchObject({ version: manifest.version });
    await expect(loadGalaxyManifestFrom("../secret", root)).rejects.toThrow(/list slug/i);
  });
});
```

- [ ] **Step 2: Run the test and confirm the missing loader**

Run: `npx vitest run lib/galaxy/manifest-store.test.ts`

Expected: FAIL because `manifest-store.ts` does not exist.

- [ ] **Step 3: Implement the generator and manifest store**

The script must use the fixed list map:

```ts
const LISTS = {
  ngsl: "NGSL",
  toeic: "TOEIC",
  business: "Business",
  academic: "Academic",
  fitness: "Fitness",
  all: "All words",
} as const;
```

It must remove only the explicit generated root `public/generated/galaxy`, recreate `manifests` and `assets`, build each graph, write asset bytes, then write the manifest last. Validate before writing that shard words and search entries both equal `graph.nodes.length`, and that decoded full words equal the same count. Use `gzipSync` to enforce a 102,400-byte compressed manifest limit for normal lists and 153,600 bytes for All Words. Log list, chart, star, asset-byte, raw-manifest-byte, and gzip-manifest-byte totals.

Implement the server loader with a slug allowlist and in-process promise cache:

```ts
const ROOT = path.join(process.cwd(), "public", "generated", "galaxy");
const VALID = new Set(["ngsl", "toeic", "business", "academic", "fitness", "all"]);
const cache = new Map<string, Promise<GalaxyManifest>>();

export async function loadGalaxyManifestFrom(slug: string, root = ROOT): Promise<GalaxyManifest> {
  if (!VALID.has(slug)) throw new Error("Invalid list slug");
  const value: unknown = JSON.parse(await readFile(path.join(root, "manifests", `${slug}.json`), "utf8"));
  if (!isGalaxyManifest(value) || value.list.slug !== slug) throw new Error("Invalid galaxy manifest");
  return value;
}

export function loadGalaxyManifest(slug: string): Promise<GalaxyManifest> {
  const hit = cache.get(slug);
  if (hit) return hit;
  const pending = loadGalaxyManifestFrom(slug).catch((error) => {
    cache.delete(slug);
    throw error;
  });
  cache.set(slug, pending);
  return pending;
}
```

- [ ] **Step 4: Wire build scripts and immutable headers**

Change `package.json` to:

```json
"build:graphs": "tsx scripts/build-graph-data.ts && tsx scripts/build-galaxy-assets.ts"
```

Add only this immutable route to `next.config.ts`; manifests retain default revalidation behaviour:

```ts
const nextConfig: NextConfig = {
  async headers() {
    return [{
      source: "/generated/galaxy/assets/:path*",
      headers: [{ key: "Cache-Control", value: "public, max-age=31536000, immutable" }],
    }];
  },
};
```

- [ ] **Step 5: Generate all production artifacts and inspect budgets**

Run: `npm run build:graphs`

Expected: six successful list summaries; generated manifest counts equal their source graph counts; every logged gzip manifest byte count is within its enforced budget. If a budget fails, reduce representative metadata; do not remove charts or word counts.

- [ ] **Step 6: Run focused tests and TypeScript**

Run: `npx vitest run lib/galaxy/manifest-store.test.ts lib/galaxy/build-artifacts.test.ts && npx tsc --noEmit`

Expected: PASS with no TypeScript errors.

- [ ] **Step 7: Commit generated delivery assets**

```bash
git add scripts/build-galaxy-assets.ts lib/galaxy/manifest-store.ts lib/galaxy/manifest-store.test.ts package.json package-lock.json next.config.ts public/generated/galaxy
git commit -m "feat: generate versioned galaxy shards"
```

---

### Task 4: Client Asset Loading, Search, and LRU Residency

**Files:**
- Create: `components/network/galaxy/asset-client.ts`
- Create: `components/network/galaxy/chart-shard-store.ts`
- Create: `components/network/galaxy/chart-shard-store.test.ts`
- Create: `components/network/galaxy/search-catalog.ts`
- Create: `components/network/galaxy/search-catalog.test.ts`

**Interfaces:**
- Consumes: `GalaxyManifest`, `ChartShard`, and `SearchCatalogData`.
- Produces: `fetchVersionedJson`, `downloadBytes`, `ChartShardStore`, and `GalaxySearchCatalog`.

- [ ] **Step 1: Write failing loader tests**

Test these concrete behaviours:

```ts
const bundle = buildGalaxyArtifacts(graph, "Fixture");
const manifest = bundle.manifest;
const shards = new Map(bundle.chartShards.map((item) => [item.data.chartId, item.data]));
const speechShard = shards.get("speech") as ChartShard;
const searchData = bundle.search.data;
const fetcher = vi.fn(async (input: string | URL | Request) => {
  const url = String(input);
  const chart = manifest.charts.find((item) => item.asset.url === url);
  const shard = chart ? shards.get(chart.id) : null;
  return shard
    ? new Response(JSON.stringify(shard), { status: 200 })
    : new Response("missing", { status: 404 });
});

it("deduplicates concurrent chart loads", async () => {
  const store = new ChartShardStore(manifest, { capacity: 2, concurrency: 2, fetcher });
  const [a, b] = await Promise.all([store.load("speech"), store.load("speech")]);
  expect(a).toBe(b);
  expect(fetcher).toHaveBeenCalledTimes(1);
});

it("evicts the least recently used unpinned shard", async () => {
  const store = new ChartShardStore(manifest, { capacity: 2, concurrency: 2, fetcher });
  await store.load("speech");
  await store.load("motion");
  await store.load("drift");
  expect(store.residentIds()).toEqual(["motion", "drift"]);
});

it("ranks exact, prefix, then one-edit fuzzy matches", async () => {
  const catalog = GalaxySearchCatalog.fromData(searchData);
  expect(catalog.find("speak")[0].lemma).toBe("speak");
  expect(catalog.find("spe").map((entry) => entry.lemma)).toContain("speak");
  expect(catalog.find("spaek")[0].lemma).toBe("speak");
});
```

Also test version mismatch, abort, failed fetch retry, and `dispose()` aborting pending work.

- [ ] **Step 2: Run tests and confirm missing classes**

Run: `npx vitest run components/network/galaxy/chart-shard-store.test.ts components/network/galaxy/search-catalog.test.ts`

Expected: FAIL because the client loaders do not exist.

- [ ] **Step 3: Implement shared fetch primitives**

Use typed errors so UI can distinguish abort, network, version, and decode failures:

```ts
export class GalaxyAssetError extends Error {
  constructor(public code: "network" | "version" | "decode", message: string, public cause?: unknown) {
    super(message);
  }
}

export async function fetchVersionedJson<T extends { version: string }>(
  url: string,
  version: string,
  signal: AbortSignal,
  guard: (value: unknown) => value is T,
  fetcher: typeof fetch = fetch,
): Promise<T> {
  const response = await fetcher(url, { signal });
  if (!response.ok) throw new GalaxyAssetError("network", `Asset request failed (${response.status})`);
  const value: unknown = await response.json();
  if (!guard(value)) throw new GalaxyAssetError("decode", "Invalid galaxy asset");
  if (value.version !== version) throw new GalaxyAssetError("version", "Galaxy asset version mismatch");
  return value;
}
```

Wrap thrown network failures as `new GalaxyAssetError("network", "Galaxy asset request failed", error)`, JSON parsing or shape-guard failures as `new GalaxyAssetError("decode", "Invalid galaxy asset", error)`, and rethrow `AbortError` unchanged. Pass `isChartShard` or `isSearchCatalogData` into the required guard argument so invalid JSON cannot reach the store.

`downloadBytes` must use this signature, stream `response.body`, call `onProgress({ loaded, total })` after each chunk, combine chunks once, and throw an abort without wrapping `AbortError`:

```ts
export type ByteProgress = { loaded: number; total: number | null };
export function downloadBytes(
  url: string,
  options: { signal: AbortSignal; onProgress: (progress: ByteProgress) => void; fetcher?: typeof fetch },
): Promise<ArrayBuffer>;
```

- [ ] **Step 4: Implement bounded chart storage**

`ChartShardStore` must expose:

```ts
type StoreOptions = {
  capacity: number;
  concurrency: number;
  fetcher?: typeof fetch;
  onEvict?: (chartId: string, shard: ChartShard) => void;
  refreshManifest?: () => Promise<GalaxyManifest>;
};

class ChartShardStore {
  load(chartId: string, options?: { pin?: boolean }): Promise<ChartShard>;
  prefetch(chartId: string): void;
  get(chartId: string): ChartShard | null;
  pin(chartId: string): void;
  unpin(chartId: string): void;
  residentIds(): string[];
  dispose(): void;
}
```

Use one queue shared by foreground and prefetch requests. Foreground requests enter before queued prefetch requests. A version mismatch retries exactly once by refetching the current manifest URL supplied through an optional `refreshManifest` callback; a second mismatch surfaces the error.

- [ ] **Step 5: Implement lazy search catalog**

`GalaxySearchCatalog` must expose `constructor(manifest, { fetcher? })`, `static fromData(data)`, `load()`, `find(query, limit = 7)`, `get(lemma)`, and `entries()`. Cache the single load promise. Normalize with `normalizeGalaxySearch`. Search ranking is exact normalized match, prefix, substring, then Levenshtein distance one for normalized queries of at least four characters. Never trigger `manifest.assets.full.url`.

- [ ] **Step 6: Run focused tests, all unit tests, and lint**

Run: `npx vitest run components/network/galaxy/chart-shard-store.test.ts components/network/galaxy/search-catalog.test.ts && npm test && npm run lint`

Expected: PASS.

- [ ] **Step 7: Commit client loading primitives**

```bash
git add components/network/galaxy/asset-client.ts components/network/galaxy/chart-shard-store.ts components/network/galaxy/chart-shard-store.test.ts components/network/galaxy/search-catalog.ts components/network/galaxy/search-catalog.test.ts
git commit -m "feat: add progressive galaxy asset loaders"
```

---

### Task 5: Progressive Scene Model and Three.js Engine

**Files:**
- Create: `components/network/galaxy/scene-model.ts`
- Create: `components/network/galaxy/scene-model.test.ts`
- Create: `components/network/galaxy/progressive-engine.ts`
- Reuse from: `components/network/galaxy/engine.ts` shader, camera, locked-up-vector, and screen-space-picking behaviour

**Interfaces:**
- Consumes: manifest, resident chart shards, decoded full data, claimed/used sets, route, selected chart, and focused word.
- Produces: `GalaxySceneModel` and `ProgressiveStarEngine` with incremental scene methods.

- [ ] **Step 1: Write failing scene-state tests**

```ts
import { describe, expect, it } from "vitest";

import { buildGalaxyArtifacts } from "@/lib/galaxy/build-artifacts";
import { decodeFullGalaxy } from "@/lib/galaxy/full-codec";
import { fixtureGraph } from "@/lib/galaxy/test-fixture";
import { GalaxySceneModel } from "./scene-model";

const bundle = buildGalaxyArtifacts(fixtureGraph, "Fixture");
const manifest = bundle.manifest;
const speechShard = bundle.chartShards.find((item) => item.data.chartId === "speech")!.data;
const motionShard = bundle.chartShards.find((item) => item.data.chartId === "motion")!.data;
const fullData = decodeFullGalaxy(
  bundle.full.bytes.buffer.slice(bundle.full.bytes.byteOffset, bundle.full.bytes.byteOffset + bundle.full.bytes.byteLength),
);

describe("GalaxySceneModel", () => {
  it("starts with proxy charts and no resident real words", () => {
    const model = new GalaxySceneModel(manifest);
    expect(model.view()).toBe("constellation");
    expect(model.residentWords()).toHaveLength(0);
  });

  it("adds and evicts one chart without disturbing another", () => {
    const model = new GalaxySceneModel(manifest);
    model.upsertChart(speechShard);
    model.upsertChart(motionShard);
    model.removeChart("speech");
    expect(model.residentWords().map((word) => word.lemma)).toEqual(motionShard.words.map((word) => word.lemma));
  });

  it("enters full mode with the exact decoded count and releases it", () => {
    const model = new GalaxySceneModel(manifest);
    model.enterFull(fullData);
    expect(model.view()).toBe("full");
    expect(model.wordCount()).toBe(manifest.list.wordCount);
    model.exitFull();
    expect(model.view()).toBe("constellation");
  });

  it("bounds the requested word labels", () => {
    const model = new GalaxySceneModel(manifest);
    model.enterFull(fullData);
    expect(model.labelCandidates({ max: 200 }).length).toBeLessThanOrEqual(200);
  });
});
```

- [ ] **Step 2: Run the test and confirm the missing scene model**

Run: `npx vitest run components/network/galaxy/scene-model.test.ts`

Expected: FAIL because `scene-model.ts` does not exist.

- [ ] **Step 3: Implement pure scene residency**

`GalaxySceneModel` must keep chart shards in a `Map`, full data separately, and expose:

```ts
type GalaxyView = "constellation" | "chart" | "full";

class GalaxySceneModel {
  constructor(manifest: GalaxyManifest);
  view(): GalaxyView;
  upsertChart(shard: ChartShard): void;
  removeChart(chartId: string): void;
  enterFull(data: FullGalaxyData): void;
  exitFull(): void;
  getWord(lemma: string): PositionedWord | null;
  residentWords(): PositionedWord[];
  wordCount(): number;
  labelCandidates(input: { focus?: string | null; hover?: string | null; route?: Set<string>; claimed?: Set<string>; max: number }): PositionedWord[];
}
```

`labelCandidates` orders focus, hover, route, claimed visible words, then degree and truncates at `max`; it never creates labels itself.

- [ ] **Step 4: Build the progressive renderer alongside the legacy engine**

Create `ProgressiveStarEngine` without changing the current import yet. Preserve the shader appearance, damped camera, `camera.up.set(0, 1, 0)`, panel offset, and screen-space 26 px picking radius. Use these public methods:

```ts
export type ProgressiveEngineOptions = {
  onSelectWord?: (lemma: string | null) => void;
  onSelectChart?: (chartId: string) => void;
  onApproachChart?: (chartId: string | null) => void;
  onZoomLevel?: (level: "galaxy" | "cluster" | "star") => void;
  onContextFailure?: () => void;
  onInteractive?: () => void;
};

export class ProgressiveStarEngine {
  constructor(host: HTMLElement, manifest: GalaxyManifest, options?: ProgressiveEngineOptions);
  upsertChart(shard: ChartShard): void;
  removeChart(chartId: string): void;
  enterFull(data: FullGalaxyData): void;
  exitFull(): void;
  setClaimed(lemmas: Set<string>): void;
  setUsed(lemmas: Set<string>): void;
  setMode(mode: "chart" | "run" | "ladder"): void;
  setRoute(lemmas: string[], index: number): void;
  setChart(chartId: string | null, options?: { keepCamera?: boolean }): void;
  focusStar(lemma: string, options?: { keepCamera?: boolean }): boolean;
  clearFocus(): void;
  resetView(): void;
  setPanelOffset(px: number): void;
  screenPosOf(lemma: string): { x: number; y: number } | null;
  dispose(): void;
}
```

Renderer implementation requirements:

- Generate at most 24 proxy points per chart from `previewSeed` and `wordCount`, with one separate proxy geometry.
- Scatter Drift proxies over the atlas as ambient field stars and omit a single Drift chart label; Drift remains loadable through search and full mode.
- Use one real-star geometry for current residents and one full geometry in full mode.
- Cross-fade a chart proxy only after `upsertChart` succeeds.
- Rebuild resident geometry only on shard add/evict, not per animation frame.
- Update edge buffers only on focus/chart/route/zoom changes.
- Maintain exactly 200 recyclable elements marked `data-star-label`; chart labels are separate.
- Project only proxy and resident/full pick candidates; reuse vectors and typed arrays.
- Emit `onApproachChart` only when cluster zoom keeps the same nearest chart for 300 ms.
- Listen for `webglcontextlost` and `webglcontextrestored`; call `onContextFailure` after one unsuccessful restoration attempt.
- Mark `galaxy:constellation-visible` after the first render, mark `galaxy:interactive` once input handlers are bound, and then call `onInteractive`.

- [ ] **Step 5: Run scene tests, TypeScript, and lint**

Run: `npx vitest run components/network/galaxy/scene-model.test.ts && npx tsc --noEmit && npm run lint`

Expected: PASS while the current page still uses the legacy engine.

- [ ] **Step 6: Commit the progressive engine**

```bash
git add components/network/galaxy/scene-model.ts components/network/galaxy/scene-model.test.ts components/network/galaxy/progressive-engine.ts
git commit -m "feat: add progressive star engine"
```

---

### Task 6: Run and Ladder Route Metadata

**Files:**
- Create: `lib/galaxy/learning-routes.ts`
- Create: `lib/galaxy/learning-routes.test.ts`
- Modify: `app/api/run/route.ts`
- Create: `app/api/ladder/route.ts`

**Interfaces:**
- Consumes: server-side `LiteGraph` and owned lemma set.
- Produces: `RunStop`, `LadderRung`, `buildRunStops`, `buildLadderRungs`, `/api/run`, and `/api/ladder` responses with chart IDs.

- [ ] **Step 1: Write failing route-selection tests**

```ts
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
  expect(rungs[0]).toMatchObject({ from: "buy", fromChartId: expect.any(String), toChartId: expect.any(String), baseHeld: true });
});
});
```

- [ ] **Step 2: Run the test and confirm missing route builders**

Run: `npx vitest run lib/galaxy/learning-routes.test.ts`

Expected: FAIL because `learning-routes.ts` does not exist.

- [ ] **Step 3: Extract deterministic route builders**

Export exact response types:

```ts
export type RunStop = { lemma: string; display: string; chartId: string };
export type LadderRung = {
  from: string;
  fromDisplay: string;
  fromChartId: string;
  to: string;
  toDisplay: string;
  toChartId: string;
  baseHeld: boolean;
  type: "advanced_form" | "builds_on";
};
```

Move the existing day/list seeded Run selection into `buildRunStops`. `buildLadderRungs` must normalize `advanced_form` direction from source to target and `builds_on` direction from target to source, deduplicate target lemmas, skip already owned targets, score held bases first, then advanced targets, then target degree, and cap at the supplied limit.

- [ ] **Step 4: Update API responses without breaking the current client**

`GET /api/run?list=ngsl` returns:

```ts
return Response.json({ stops, route: stops.map((stop) => stop.lemma), day });
```

`GET /api/ladder?list=ngsl` reads `ownerToken`, calls `getMySummary`, and returns:

```ts
return Response.json({ rungs: buildLadderRungs(graph, new Set(summary?.lemmas || []), 7) });
```

Validate the list against the six-list allowlist before loading a graph; invalid input returns status 400.

- [ ] **Step 5: Run route tests and all unit tests**

Run: `npx vitest run lib/galaxy/learning-routes.test.ts && npm test`

Expected: PASS.

- [ ] **Step 6: Commit learning route metadata**

```bash
git add lib/galaxy/learning-routes.ts lib/galaxy/learning-routes.test.ts app/api/run/route.ts app/api/ladder/route.ts
git commit -m "feat: expose chart-aware learning routes"
```

---

### Task 7: Progressive Controller and Page Migration

**Files:**
- Create: `components/network/galaxy/galaxy-controller.ts`
- Create: `components/network/galaxy/galaxy-controller.test.ts`
- Create: `components/network/star-atlas-entry.tsx`
- Modify: `components/network/star-atlas.tsx`
- Modify: `app/network/[listSlug]/page.tsx`
- Create: `app/network/[listSlug]/error.tsx`

**Interfaces:**
- Consumes: manifest, shard store, search catalog, progressive engine, collection summary, and chart-aware Run/Ladder APIs.
- Produces: normal progressive browsing, chart selection, word selection, search flight, and preserved learning UI.

- [ ] **Step 1: Write failing controller tests with fake engine and fetchers**

```ts
const bundle = buildGalaxyArtifacts(fixtureGraph, "Fixture");
const manifest = bundle.manifest;
const speechShard = bundle.chartShards.find((item) => item.data.chartId === "speech")!.data;
const searchData = bundle.search.data;
const store = {
  load: vi.fn(async () => speechShard), prefetch: vi.fn(), pin: vi.fn(), unpin: vi.fn(), dispose: vi.fn(),
};
const catalog = {
  load: vi.fn(async () => searchData), find: vi.fn(), get: vi.fn((lemma: string) => searchData.entries.find((entry) => entry.lemma === lemma) || null),
};
const engine = {
  upsertChart: vi.fn(), removeChart: vi.fn(), setChart: vi.fn(), focusStar: vi.fn(() => true),
};
const controller = new GalaxyController({ manifest, store, catalog, engine, saveData: false });

it("loads a chart before installing it in the engine", async () => {
  await controller.openChart("speech");
  expect(store.load).toHaveBeenCalledWith("speech", { pin: true });
  expect(engine.upsertChart).toHaveBeenCalledWith(speechShard);
  expect(engine.setChart).toHaveBeenCalledWith("speech");
});

it("resolves search, loads its chart, then focuses the real star", async () => {
  const result = await controller.openWord("speak");
  expect(result).toBe(true);
  expect(engine.upsertChart).toHaveBeenCalledWith(speechShard);
  expect(engine.focusStar).toHaveBeenCalledWith("speak", { keepCamera: false });
});

it("loads the approached chart but does not prefetch its neighbour when data saving is enabled", async () => {
  controller.setSaveData(true);
  controller.approachChart("motion");
  await Promise.resolve();
  vi.advanceTimersByTime(1000);
  expect(store.load).toHaveBeenCalledWith("motion", { pin: false });
  expect(store.prefetch).not.toHaveBeenCalled();
});
```

Also test Retry after a failed shard, stale-selection cancellation, and desktop/mobile capacities.

- [ ] **Step 2: Run the controller test and confirm failure**

Run: `npx vitest run components/network/galaxy/galaxy-controller.test.ts`

Expected: FAIL because `galaxy-controller.ts` does not exist.

- [ ] **Step 3: Implement the controller**

Expose:

```ts
export type GalaxyControllerStatus = {
  chartId: string | null;
  chartLoad: "idle" | "loading" | "ready" | "error";
  chartError: string | null;
  searchLoad: "idle" | "loading" | "ready" | "error";
};

export type GalaxyControllerStore = Pick<ChartShardStore, "load" | "prefetch" | "pin" | "unpin" | "dispose">;
export type GalaxyControllerCatalog = Pick<GalaxySearchCatalog, "load" | "find" | "get">;
export type GalaxyControllerEngine = Pick<ProgressiveStarEngine, "upsertChart" | "removeChart" | "setChart" | "focusStar">;

export class GalaxyController {
  constructor(input: { manifest: GalaxyManifest; store: GalaxyControllerStore; catalog: GalaxyControllerCatalog; engine: GalaxyControllerEngine; saveData: boolean });
  openChart(chartId: string): Promise<ChartShard | null>;
  openWord(lemma: string): Promise<boolean>;
  search(query: string): Promise<SearchEntry[]>;
  approachChart(chartId: string | null): void;
  setSaveData(value: boolean): void;
  retryChart(): Promise<ChartShard | null>;
  subscribe(listener: (status: GalaxyControllerStatus) => void): () => void;
  dispose(): void;
}
```

Foreground chart selection pins the new chart and unpins the previous chart after the transition. Because the engine has already applied the 300 ms stable-camera dwell, `approachChart` immediately loads that chart unpinned and installs it without moving the camera. It then schedules the approached chart's strongest unloaded neighbor for one prefetch after 750 ms without another approach/input event, only when Save-Data is false. `openWord` loads the catalog if necessary, resolves the chart, awaits `openChart`, then focuses the star. A superseded selection must not focus after its request resolves.

- [ ] **Step 4: Add the correct Next.js client-only boundary**

Create `star-atlas-entry.tsx` as a Client Component because Next.js 16 allows `ssr: false` only inside a Client Component:

```tsx
"use client";

import dynamic from "next/dynamic";
import type { GalaxyManifest } from "@/lib/galaxy/types";

const StarAtlas = dynamic(
  () => import("./star-atlas").then((module) => module.StarAtlas),
  { ssr: false, loading: () => <div aria-live="polite" className="atlas-loading-shell">Charting constellations…</div> },
);

export function StarAtlasEntry(props: { manifest: GalaxyManifest; listSlug: string }) {
  return <StarAtlas {...props} />;
}
```

- [ ] **Step 5: Migrate `StarAtlas` from whole graph to manifest**

Change the prop to `{ manifest: GalaxyManifest; listSlug: string }`, construct `ProgressiveStarEngine`, `ChartShardStore`, `GalaxySearchCatalog`, and `GalaxyController` once per manifest version, and dispose all four together.

Replace whole-graph dependencies exactly as follows:

- Chart rail and chart names/counts: `manifest.charts`.
- Legend totals: `manifest.list.coreCount`, `advancedCount`, and `driftCount`.
- Search results and held-word metadata: lazy `GalaxySearchCatalog`.
- Active-chart quiz distractors and focused adjacency: resident `ChartShard`.
- Run: `/api/run` `stops`, opening each stop through `controller.openWord`.
- Ladder: `/api/ladder` `rungs`, opening targets through `controller.openWord`.
- Chart completion: manifest total plus owned lemmas mapped through the catalog after `/api/me` resolves.
- Drawer connection click: catalog lookup followed by target chart load; retain the wiki connection gloss unchanged.
- Space coverage: calculate after catalog load; show a calm loading row before it is available.

Show `Constellation view · {chartCount} charts · {wordCount} stars` before any shard loads. Show non-blocking chart status text and Retry on `chartLoad === "error"`. Search-index failure disables only search and exposes Retry.

- [ ] **Step 6: Switch the server page to the small manifest**

Replace `loadListGraph` with `loadGalaxyManifest` and render:

```tsx
const manifest = await loadGalaxyManifest(listSlug);
return (
  <div className={`${serif.variable} ${sans.variable} ${mono.variable}`} style={{ position: "fixed", inset: 0, background: "#070B16" }}>
    <StarAtlasEntry manifest={manifest} listSlug={listSlug} />
  </div>
);
```

The route error component must be a Client Component with a visible message and a button calling `reset()`; it must not invent an empty manifest.

- [ ] **Step 7: Verify normal browsing before committing**

Run: `npx vitest run components/network/galaxy/galaxy-controller.test.ts && npx tsc --noEmit && npm run lint && npm run build`

Expected: all commands pass; build output still pre-renders all six list routes.

Run the app and verify NGSL initial page source no longer contains a known deep node such as `"abandon"` repeated inside a serialized full graph. Network inspection must show no chart/search/full asset until chart selection, search focus, Run/Ladder, or owned-catalog mapping requests it.

- [ ] **Step 8: Commit the progressive page switch**

```bash
git add components/network/galaxy/galaxy-controller.ts components/network/galaxy/galaxy-controller.test.ts components/network/star-atlas-entry.tsx components/network/star-atlas.tsx app/network/[listSlug]/page.tsx app/network/[listSlug]/error.tsx
git commit -m "feat: stream charts into Star Atlas"
```

---

### Task 8: Optional Full-List Galaxy Mode

**Files:**
- Create: `components/network/galaxy/full-decoder.worker.ts`
- Create: `components/network/galaxy/full-galaxy-loader.ts`
- Create: `components/network/galaxy/full-galaxy-loader.test.ts`
- Create: `components/network/galaxy/full-mode-state.ts`
- Create: `components/network/galaxy/full-mode-state.test.ts`
- Create: `components/network/full-galaxy-dialog.tsx`
- Modify: `components/network/star-atlas.tsx`

**Interfaces:**
- Consumes: `manifest.assets.full`, `downloadBytes`, `decodeFullGalaxy`, and `ProgressiveStarEngine.enterFull/exitFull`.
- Produces: warned, cancellable, exact-count full mode for the active list.

- [ ] **Step 1: Write failing loader and reducer tests**

```ts
const bundle = buildGalaxyArtifacts(fixtureGraph, "Fixture");
const manifest = bundle.manifest;
const decoded = decodeFullGalaxy(
  bundle.full.bytes.buffer.slice(bundle.full.bytes.byteOffset, bundle.full.bytes.byteOffset + bundle.full.bytes.byteLength),
);
class FakeWorker extends EventTarget {
  terminate = vi.fn();
  postMessage() {
    queueMicrotask(() => this.dispatchEvent(new MessageEvent("message", { data: { type: "ready", data: decoded } })));
  }
}
const worker = new FakeWorker();
const loader = new FullGalaxyLoader(manifest, {
  download: async (_url, { onProgress }) => {
    onProgress({ loaded: bundle.full.bytes.byteLength, total: bundle.full.bytes.byteLength });
    return bundle.full.bytes.slice().buffer;
  },
  createWorker: () => worker as unknown as Worker,
});

it("reports download and preparation progress before returning exact data", async () => {
  const events: string[] = [];
  const data = await loader.load({
    signal: new AbortController().signal,
    onProgress: (progress) => events.push(progress.stage),
  });
  expect(events).toContain("downloading");
  expect(events).toContain("preparing");
  expect(data.words).toHaveLength(manifest.list.wordCount);
});

it("aborts and terminates worker resources", async () => {
  const controller = new AbortController();
  const pending = loader.load({ signal: controller.signal, onProgress: () => undefined });
  controller.abort();
  await expect(pending).rejects.toMatchObject({ name: "AbortError" });
  expect(worker.terminate).toHaveBeenCalled();
});

it("returns to idle after cancelling", () => {
  const loading = reduceFullMode(initialFullModeState, { type: "confirm" });
  expect(reduceFullMode(loading, { type: "cancel" })).toEqual(initialFullModeState);
});
```

- [ ] **Step 2: Run the tests and confirm missing loader/state**

Run: `npx vitest run components/network/galaxy/full-galaxy-loader.test.ts components/network/galaxy/full-mode-state.test.ts`

Expected: FAIL because the modules do not exist.

- [ ] **Step 3: Decode full data in a worker**

The worker accepts `{ type: "decode", buffer, expectedVersion, expectedCount }`, calls `decodeFullGalaxy`, validates version and word count, and posts either `{ type: "ready", data }` transferring the decoded backing buffer or `{ type: "error", message }`. It must never catch an error and return fabricated empty data.

Create workers with the bundler-supported static URL:

```ts
const worker = new Worker(new URL("./full-decoder.worker.ts", import.meta.url));
```

`FullGalaxyLoader.load` streams bytes with progress, posts the transferred buffer, reports preparation, resolves only after exact-count validation, and always removes listeners and terminates the worker on success, error, or abort.

Use dependency injection only for deterministic tests; production defaults remain the real downloader and worker:

```ts
type FullGalaxyLoaderDependencies = {
  download?: typeof downloadBytes;
  createWorker?: () => Worker;
};

export class FullGalaxyLoader {
  constructor(manifest: GalaxyManifest, dependencies?: FullGalaxyLoaderDependencies);
  load(input: { signal: AbortSignal; onProgress: (progress: FullLoadProgress) => void }): Promise<FullGalaxyData>;
}
```

- [ ] **Step 4: Implement the finite full-mode state reducer**

Use these states and events:

```ts
export type FullModeState =
  | { phase: "idle" }
  | { phase: "confirm" }
  | { phase: "loading"; stage: "downloading" | "preparing"; loaded: number; total: number | null }
  | { phase: "ready" }
  | { phase: "error"; message: string };

export type FullModeEvent =
  | { type: "open" }
  | { type: "confirm" }
  | { type: "progress"; stage: "downloading" | "preparing"; loaded: number; total: number | null }
  | { type: "ready" }
  | { type: "fail"; message: string }
  | { type: "cancel" }
  | { type: "exit" };
```

Only `confirm` can start loading; `cancel` and `exit` always return to idle.

- [ ] **Step 5: Add the accessible warning/progress UI**

`FullGalaxyDialog` receives manifest list label/count/full bytes, reducer state, and handlers. It uses `role="dialog"`, `aria-modal="true"`, an initial heading focus, Escape cancellation, focus trapping, and an `aria-live="polite"` progress line. Copy must include:

```text
Load the complete NGSL galaxy?
5,205 stars · approximately 1.2 MB
This may take several seconds and could run slowly on mobile devices.
```

Use live manifest values rather than hard-coded counts or bytes. Buttons are **Load full galaxy**, **Cancel**, **Retry**, and **Return to constellation view** as applicable.

- [ ] **Step 6: Wire full mode into Star Atlas**

Place **Load full {list label} galaxy** with viewing controls and in the compact mobile menu. On confirmation:

1. Keep the constellation interactive.
2. Stream and decode with one `AbortController`.
3. Call `engine.enterFull(data)` only after validation.
4. Set status to ready and announce the exact star count.
5. On error or cancel, call `engine.exitFull()` and preserve constellation browsing.
6. On return, call `engine.exitFull()`, clear decoded references, terminate work, and restore chart proxies.
7. Dispose full resources during list navigation/unmount.

Never write full-mode state to local storage or the URL.

- [ ] **Step 7: Run tests and production checks**

Run: `npx vitest run components/network/galaxy/full-galaxy-loader.test.ts components/network/galaxy/full-mode-state.test.ts && npx tsc --noEmit && npm run lint && npm run build`

Expected: PASS.

- [ ] **Step 8: Commit optional full mode**

```bash
git add components/network/galaxy/full-decoder.worker.ts components/network/galaxy/full-galaxy-loader.ts components/network/galaxy/full-galaxy-loader.test.ts components/network/galaxy/full-mode-state.ts components/network/galaxy/full-mode-state.test.ts components/network/full-galaxy-dialog.tsx components/network/star-atlas.tsx
git commit -m "feat: add optional full-list galaxy mode"
```

---

### Task 9: Adaptive Quality, WebGL Fallback, and Accessibility

**Files:**
- Create: `components/network/galaxy/quality.ts`
- Create: `components/network/galaxy/quality.test.ts`
- Create: `components/network/galaxy/fallback-constellation.tsx`
- Modify: `components/network/galaxy/progressive-engine.ts`
- Modify: `components/network/star-atlas.tsx`

**Interfaces:**
- Consumes: viewport, reduced-motion preference, Save-Data hint, measured frame duration, manifest charts, and engine context events.
- Produces: `GalaxyQualityProfile`, automatic degradation, and a non-WebGL chart navigation surface.

- [ ] **Step 1: Write failing quality-policy tests**

```ts
it("starts mobile with bounded DPR and three resident charts", () => {
  expect(initialQuality({ width: 390, devicePixelRatio: 3, reducedMotion: false })).toMatchObject({
    tier: "mobile", pixelRatio: 1.25, residentCharts: 3,
  });
});

it("degrades effects before interaction content", () => {
  const degraded = degradeQuality(initialQuality({ width: 1440, devicePixelRatio: 2, reducedMotion: false }));
  expect(degraded.backgroundStars).toBeLessThan(1500);
  expect(degraded.residentCharts).toBe(8);
});

it("removes decorative motion for reduced-motion users", () => {
  expect(initialQuality({ width: 390, devicePixelRatio: 2, reducedMotion: true }).twinkle).toBe(false);
});
```

- [ ] **Step 2: Run the test and confirm missing policy**

Run: `npx vitest run components/network/galaxy/quality.test.ts`

Expected: FAIL because `quality.ts` does not exist.

- [ ] **Step 3: Implement measured quality degradation**

Use profiles:

```ts
export type GalaxyQualityProfile = {
  tier: "mobile" | "desktop";
  pixelRatio: number;
  residentCharts: number;
  backgroundStars: number;
  glow: 0 | 1 | 2;
  twinkle: boolean;
  transitionMs: number;
};
```

Mobile starts at DPR `min(devicePixelRatio, 1.25)`, 700 background stars, glow 1, and three resident charts. Desktop starts at DPR `min(devicePixelRatio, 1.75)`, 1,500 background stars, glow 2, and eight resident charts. After 120 measured frames, degrade one step when average frame time exceeds 33 ms; wait another 120 frames before another step. Degrade background count, then glow, then DPR to a floor of 1. Never lower resident charts below the device profile or remove pickable stars.

- [ ] **Step 4: Add SVG constellation fallback**

Render chart centres projected into a stable `viewBox="0 0 1000 700"`. Each chart is a keyboard-focusable SVG group with `role="button"`, `tabIndex={0}`, chart name, word count, and Enter/Space activation. Use chart size for circle radius but enforce a 28 px-equivalent hit target. The fallback must call the same `controller.openChart`. After its shard loads, render that shard's words as a keyboard-operable list beside the SVG; selecting an item calls `controller.openWord`. This list is the non-spatial replacement for star picking.

- [ ] **Step 5: Connect quality and context failure**

Add `setQuality(profile: GalaxyQualityProfile): void` to `ProgressiveStarEngine`. Call it immediately after construction with the initial profile and use it for later degradations; it updates renderer pixel ratio, background draw range, glow uniforms, and transition duration without recreating word buffers. If `WebGLRenderer` construction throws or `onContextFailure` fires, dispose the engine, set `renderFallback = true`, and preserve search, rail, details, Run, Ladder, Tutor, and full-mode warning. Disable full mode in 2D fallback with the honest message **Full 3D mode is unavailable in this browser.**

Add visible keyboard focus, chart-load `aria-live` text, Escape handling for menus/drawers/dialogs, and reduced camera transition duration from the profile. Do not rely on colour alone for held/selected/route states.

- [ ] **Step 6: Run quality tests, lint, and build**

Run: `npx vitest run components/network/galaxy/quality.test.ts && npm test && npm run lint && npm run build`

Expected: PASS.

- [ ] **Step 7: Commit adaptive and accessible fallback behaviour**

```bash
git add components/network/galaxy/quality.ts components/network/galaxy/quality.test.ts components/network/galaxy/fallback-constellation.tsx components/network/galaxy/progressive-engine.ts components/network/star-atlas.tsx
git commit -m "feat: adapt galaxy quality and fallback"
```

---

### Task 10: Browser Verification, Performance Gates, Cleanup, and Documentation

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Create: `playwright.config.ts`
- Create: `tests/e2e/galaxy-progressive.spec.ts`
- Create: `tests/e2e/galaxy-performance.spec.ts`
- Modify: `README.md`
- Delete after verification: `components/network/galaxy/atlas.ts`
- Delete after verification: `components/network/galaxy/engine.ts`

**Interfaces:**
- Consumes: the complete progressive route and performance marks.
- Produces: repeatable production-browser evidence, current architecture documentation, and removal of the whole-graph client path.

- [ ] **Step 1: Install and configure Playwright**

Run: `npm install --save-dev @playwright/test`

Run: `npx playwright install chromium`

Add scripts:

```json
"test:e2e": "playwright test tests/e2e/galaxy-progressive.spec.ts",
"test:perf": "playwright test tests/e2e/galaxy-performance.spec.ts"
```

Configure one Chromium project and a production web server:

```ts
import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 60_000,
  use: { baseURL: "http://127.0.0.1:3000", trace: "retain-on-failure" },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: "npm run build && npm start",
    url: "http://127.0.0.1:3000/network/ngsl",
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
  },
});
```

- [ ] **Step 2: Write end-to-end progressive-flow tests**

Cover these exact assertions:

```ts
test("normal opening stays at constellation data until interaction", async ({ page }) => {
  const galaxyAssets: string[] = [];
  page.on("request", (request) => {
    if (request.url().includes("/generated/galaxy/assets/")) galaxyAssets.push(request.url());
  });
  await page.goto("/network/ngsl");
  await expect(page.getByText(/Constellation view/i)).toBeVisible();
  expect(galaxyAssets).toEqual([]);
  await page.getByRole("button", { name: /Speaking & Listening/i }).click();
  await expect.poll(() => galaxyAssets.some((url) => url.includes("chart"))).toBe(true);
  expect(galaxyAssets.some((url) => url.includes("full"))).toBe(false);
});
```

Also test search-to-star flight, chart Retry after a one-time failed route, Run/Ladder route loading without full asset, full warning cancellation, full exact count, return-to-constellation cleanup, keyboard chart activation, reduced motion, and list switching.

- [ ] **Step 3: Add throttled performance gates**

Before navigation, install a long-task observer with `page.addInitScript` that stores durations in `window.__galaxyLongTasks`. Use a Chromium CDP session with `Emulation.setCPUThrottlingRate({ rate: 4 })` and `Network.emulateNetworkConditions({ offline: false, latency: 150, downloadThroughput: 500_000, uploadThroughput: 250_000, connectionType: "cellular4g" })`. Read `galaxy:constellation-visible`, `galaxy:interactive`, long tasks, requested bytes, and DOM counts. Assert:

```ts
expect(metrics.constellationMs).toBeLessThanOrEqual(2000);
expect(metrics.interactiveMs).toBeLessThanOrEqual(3000);
expect(metrics.longestStartupTaskMs).toBeLessThanOrEqual(50);
expect(metrics.starLabelNodes).toBeLessThanOrEqual(200);
expect(metrics.fullAssetRequested).toBe(false);
```

Run the timing test five times, sort each metric, and assert the fourth value as the local 75th percentile. Record frame durations during a scripted orbit and require the 75th percentile to be at most 33 ms on the mobile profile. Keep full-mode count/cleanup as correctness checks rather than applying the normal first-load timing budget.

- [ ] **Step 4: Run the complete browser suite**

Run: `npm run test:e2e && npm run test:perf`

Expected: all progressive, accessibility, request-boundary, and performance assertions pass for NGSL; the All Words full-mode test reports exactly the manifest count.

- [ ] **Step 5: Remove the legacy whole-graph browser path**

Run: `rg -n "toAtlas|AtlasData|from \"@/components/network/galaxy/engine\"|LiteGraph" components/network app/network`

Expected before deletion: matches only in the two legacy files or no longer-used imports. Delete `components/network/galaxy/atlas.ts` and `components/network/galaxy/engine.ts`, remove dead imports, and rerun the search.

Expected after deletion: no route or client component imports the legacy graph adapter or engine. Keep `data/generated/graphs/*.json` and `lib/wiki/graph-store.ts` because server APIs still use them.

- [ ] **Step 6: Update README architecture and commands**

Document:

- Star Atlas uses raw Three.js progressive constellations, not `react-force-graph-3d`.
- `npm run build:graphs` emits server graphs plus public manifest/shard/search/full assets.
- The page embeds only a manifest; chart and search data are lazy.
- Full mode is optional and scoped to the selected list.
- Generated assets must be rebuilt and committed after wiki or chart-name changes.
- Performance and browser commands are `npm run test:e2e` and `npm run test:perf`.

- [ ] **Step 7: Run final verification from a clean production build**

Run:

```bash
npm run build:graphs
npm test
npm run lint
npx tsc --noEmit
npm run build
npm run test:e2e
npm run test:perf
git diff --check
git status --short
```

Expected: every command passes; generated assets are current; only intended implementation and generated files are changed before the final commit.

- [ ] **Step 8: Commit verified migration**

```bash
git add package.json package-lock.json playwright.config.ts tests/e2e README.md components/network public/generated/galaxy docs/superpowers/specs/2026-08-10-progressive-galaxy-loading-design.md
git commit -m "test: verify progressive galaxy performance"
```

Do not push from the agent. Eric pushes `cursor/ngsl-mood-trainer` to GitHub, after which the connected Vercel project performs the production deployment.
