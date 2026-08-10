# Progressive Galaxy Loading Design

**Status:** Approved design; written specification pending review

**Date:** 2026-08-10

**Scope:** `/network/[listSlug]` Star Atlas loading, rendering, search, and optional full-list mode

## Context

The current Star Atlas sends an entire list graph through the initial React Server Component payload and constructs the complete scene in the browser. The generated graph files are approximately 3.1 MB for NGSL and 4.5 MB for All Words before transport compression. Startup then performs deterministic relaxation in the browser, creates one HTML label for every word, and scans all words and edges during every animation frame.

Rendering 5,000–12,000 GPU points is not itself the main problem. Initial network transfer, JSON parsing, main-thread layout work, thousands of DOM nodes, and per-frame CPU loops make the opening experience slow and fragile on ordinary phones.

The product should still feel like one large vocabulary universe. The solution is progressive disclosure: render the complete chart-level atlas immediately, then materialize real word stars only where the learner explores.

## Goals

- Make the chart-constellation overview interactive within 2–3 seconds on a mid-range mobile device over simulated 4G.
- Preserve the visual impression of a complete vocabulary universe.
- Let a learner enter any chart, search for any word, and navigate directly to it.
- Keep Chart, Run, Ladder, collection highlighting, word details, and learning activities functional.
- Support an explicit, warned **Load full galaxy** mode for the currently selected list.
- Make the normal experience scale beyond the current 12,115-page wiki without making first load proportional to total vocabulary count.
- Remove expensive browser-side layout generation and thousands of hidden word-label elements.

## Non-goals

- Normal constellation mode will not download or render every real word at startup.
- Full-list mode will not display every individual edge simultaneously.
- Version one will not add offline installation, a service worker, or a second persistent client database.
- The clustering algorithm and wiki content model are unchanged by this work.
- Full-list mode is a best-effort power-user feature; its performance warning is intentional and it does not define the normal mobile performance budget.

## User Experience

### Opening a list

The first scene shows every chart as a lightweight constellation. Each constellation has its current themed chart name, glyph, colour, approximate density, and spatial position. Representative points are deterministic visual proxies, not claimable word stars. The interface labels this state **Constellation view** and shows the list's chart and word counts.

The learner can rotate, zoom, select a chart from the rail, or tap a constellation immediately. A tap, rail selection, search result, Run route, or Ladder route requests its chart shard immediately. Proximity loading occurs only after the camera reaches cluster zoom and the same chart remains nearest for 300 ms, preventing a fast camera sweep from downloading many charts. Its proxy points cross-fade into real, clickable word stars when the shard is ready.

Foreground chart requests use at most two concurrent transfers on mobile and four on desktop. One neighboring chart may be prefetched after 750 ms without input, but only after the first scene is interactive and only when the browser has not enabled its data-saving preference.

On constrained devices, only the three most recently used chart scenes remain resident. Desktop keeps up to eight. Eviction removes GPU buffers and labels but leaves immutable network responses in the browser's normal HTTP cache.

### Search

The search index is a separate compact asset and is not required for first paint. It loads when the search control receives focus, during browser idle time, or when an existing collection needs word-to-chart mapping.

Searching resolves a normalized word or phrase to its chart, loads that chart shard if needed, moves the camera to the chart, and highlights the real star. A no-match state must not trigger a full-graph download.

### Full-list mode

The main viewing controls include **Load full [list name] galaxy**. The command always refers to the currently selected list:

- NGSL loads all NGSL stars.
- Academic loads all Academic stars.
- All Words loads all 12,115 current stars.

Before loading, a confirmation panel shows the exact star count, estimated transfer size, and this warning: **This may take several seconds and could run slowly on mobile devices.** It offers **Load full galaxy** and **Cancel**.

Loading is non-blocking and reports three stages: downloading, preparing stars, and ready. The learner can continue moving the constellation overview or cancel. Cancellation aborts active work, disposes partial GPU allocations, and returns to constellation mode.

Full mode places every word in the selected list in one GPU-backed point set. Every star remains searchable and clickable. At overview distance, only chart-level relationship paths are shown. Detailed edges appear for the nearby chart, hovered star, selected star, active route, or learning task. A **Return to constellation view** action disposes full-mode buffers and restores lightweight chart loading.

Full mode is not persisted across navigation or reload. This prevents a learner from accidentally reopening a heavy scene on a weaker device.

## Data Architecture

All assets are generated from the existing pre-generated list graph, which remains derived from wiki frontmatter and wiki links. The wiki remains the source of truth.

### List manifest

Each list has one small manifest containing:

```ts
type GalaxyManifest = {
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
  charts: Array<{
    id: string;
    name: string;
    glyph: string;
    hue: string;
    wordCount: number;
    center: [number, number, number];
    radius: number;
    previewSeed: number;
    neighbors: Array<{ chartId: string; weight: number }>;
    asset: { url: string; bytes: number };
  }>;
  assets: {
    searchIndex: { url: string; bytes: number };
    full: { url: string; bytes: number };
  };
};
```

The client generates a bounded number of representative points from `previewSeed`, `wordCount`, `center`, and `radius`. The manifest therefore does not repeat word records.

### Chart shards

Each chart shard contains only the data required to render and interact with that chart:

```ts
type ChartShard = {
  version: string;
  listSlug: string;
  chartId: string;
  words: Array<{
    lemma: string;
    display: string;
    tier: "core" | "advanced";
    partOfSpeech: string;
    rank: number | null;
    degree: number;
    xyz: [number, number, number];
  }>;
  edges: Array<{
    source: string;
    target: string;
    type: string;
  }>;
  portals: Array<{
    source: string;
    target: string;
    targetChart: string;
    type: string;
  }>;
};
```

Internal edges support chart exploration. Portals retain cross-chart navigation without pulling the neighboring chart into the shard. Following a portal loads the target chart before focusing its word.

### Search index

The search asset contains normalized lookup keys, display labels, lemmas, and chart IDs. It does not contain definitions, examples, or edges. Exact matches rank first, followed by prefix and bounded fuzzy matches. Definitions continue to load from the existing word API after selection.

### Full-list asset

The full-list file is a compact binary payload with a string table and typed arrays for positions, chart IDs, tier, rank, and degree. It deliberately excludes definitions and the complete edge set. Focused edges are read from an already cached chart shard or fetched by chart on demand.

The binary asset duplicates derived render data, not authored content. It is a disposable build artifact and can always be regenerated from the wiki graph.

### Versioning and delivery

The build assigns content-hashed filenames to search, chart, and full assets. The manifest points to those names. Vercel can serve them as immutable static assets through its CDN, and a new build naturally invalidates old manifests without manual cache clearing.

The initial Next.js page passes only the manifest and list metadata to the client. It no longer serializes `LiteGraph` into the page HTML.

## Layout and Rendering

All real star positions are computed by the build pipeline. The browser never runs the current 90-pass relaxation loop.

The renderer has three scene states with one public interface:

1. **Constellation:** chart proxy points and chart labels only.
2. **Chart:** constellation scene plus one or more resident real chart shards.
3. **Full:** one compact point buffer for every word in the selected list.

Word stars are rendered with `THREE.Points` and typed attributes. Chart proxy points use a separate point buffer so they can cross-fade without rebuilding the entire scene. Edges use bounded line buffers that are rewritten only when focus, route, chart, or zoom-band state changes.

The renderer must not create one DOM node per word. It maintains chart labels plus a small recyclable label pool for visible nearby, hovered, selected, route, and claimed words. Picking remains screen-space based, as required by the Star Atlas interaction design. The picking index considers only resident and visible stars.

Per-frame work is limited to visible/resident points and active bounded edge buffers. Static positions are not rewritten every frame. Temporary vectors and sets are reused to avoid animation-loop allocation.

## Runtime Components

- `GalaxyManifestLoader` loads and validates the lightweight list manifest.
- `ChartShardStore` fetches, deduplicates, cancels, and LRU-evicts chart shards.
- `GalaxySearchIndex` lazy-loads lookup data and resolves words to charts.
- `FullGalaxyLoader` downloads and decodes the optional binary payload with progress and cancellation.
- `StarEngine` renders constellation, chart, and full scene states behind a stable API.
- `GalaxyQualityController` selects pixel ratio, glow, background density, and resident-chart limits from viewport, reduced-motion preference, and measured frame time.
- `StarAtlas` coordinates product state, APIs, modes, dialogs, progress, and accessible controls without owning low-level buffers.

These boundaries allow artifact generation, transport, rendering, and product UI to be tested independently.

## Learning Modes and Collection State

Chart mode loads its selected chart normally. Run and Ladder routes return enough chart information to request route shards before activating the route. A route never causes an unbounded full-list request.

The collection API continues to return owned lemmas. After first paint, the search index maps those lemmas to chart IDs so the overview can show per-chart collection progress. Word-level claimed styling appears when a chart shard is resident or full mode is active.

Definitions, examples, rarity, quizzes, composition grading, and tutor context remain demand-loaded through their existing APIs.

## Adaptive Quality

The default mobile profile uses a lower device-pixel ratio, fewer background stars, reduced glow, and a three-chart resident limit. Desktop starts with richer effects and an eight-chart limit. These are starting profiles, not permanent device labels.

The quality controller samples frame duration after interaction begins. If sustained frame rate drops below the target, it progressively lowers background density, glow work, and pixel ratio. It does not remove learning content or make stars unclickable. Reduced-motion users receive shorter camera transitions and no decorative twinkle dependence.

## Accessibility

The chart rail and search remain complete alternatives to spatial navigation. Every loaded word can be reached through keyboard search and chart word lists. Focus indicators, dialog focus trapping, escape-to-cancel, progress text, and live status announcements are required. Visual colour is never the only indication of claimed, route, or selected state.

## Error Handling

- A manifest failure shows a retry state instead of a blank canvas.
- A chart-shard failure leaves its constellation visible and offers Retry.
- Search-index failure leaves chart browsing intact and explains that search is temporarily unavailable.
- Full-mode failure or cancellation disposes partial work and returns to constellation mode.
- Stale asset versions trigger one manifest refresh; repeated mismatch becomes a visible retry error rather than an infinite loop.
- WebGL context loss pauses animation, attempts restoration, and falls back to a simplified 2D constellation if restoration fails.
- Unsupported WebGL starts directly in the 2D chart-constellation fallback. Search, chart lists, word details, and exercises remain available.

No failure path silently substitutes fabricated word data or AI output.

## Performance Budgets

Normal mode is tested on a mid-range mobile profile with simulated 4G and CPU throttling:

- Chart manifest: at most 100 KB compressed for a normal list and 150 KB for All Words.
- First constellation visible: at most 2 seconds at the 75th percentile.
- First interaction ready: at most 3 seconds at the 75th percentile.
- Sustained interaction: at least 30 FPS, with a 33 ms frame-time budget.
- Main-thread startup task: no single graph-processing task longer than 50 ms.
- Word-label DOM pool: at most 200 nodes.
- Initial request path: no chart shard, search index, or full-list asset is required.

Desktop normal mode targets 55–60 FPS. Full-list mode reports progress and uses adaptive quality, but it is exempt from the normal first-load budget because the learner explicitly opts into it after a warning.

## Verification

### Artifact tests

- Every source word appears exactly once in its list's chart shards.
- Drift words are represented and remain searchable.
- Every chart shard and full-list asset reports the same list version as the manifest.
- Every internal edge references two words in the shard.
- Every portal resolves to a real target chart and word.
- Search entries resolve to the correct lemma and chart.
- Full-list star count exactly equals the selected list graph count.
- Position output is deterministic for identical graph input.

### Runtime tests

- Initial navigation requests only the page and manifest graph data.
- Chart click, proximity load, idle prefetch, LRU eviction, and reload work.
- Search loads its index lazily, loads the target shard, and focuses the word.
- Full mode confirms, reports progress, supports cancellation, and releases memory on exit.
- Network failures preserve the lightweight scene and expose Retry.
- Run and Ladder load all route charts without requesting the full list.
- Reduced motion, keyboard navigation, narrow viewport, and 2D fallback remain usable.

### Performance tests

Automated browser measurements record asset bytes, first-constellation time, interaction readiness, long tasks, frame duration, DOM count, and peak memory where supported. Fixtures cover NGSL and All Words, including the 12,115-star full-mode case. A production build must pass correctness tests before performance results are interpreted.

## Rollout

The new manifest and shards can be generated alongside the existing graph JSON. The progressive loader first replaces the normal startup path while keeping the existing full graph available as a rollback asset. Search and learning modes migrate next. Optional full-list mode is enabled only after its exact-count, cancellation, and memory-release tests pass. The old graph-as-page-prop path is removed after all six list routes pass browser verification.
