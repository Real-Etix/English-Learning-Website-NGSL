# Task 9 Implementer Report

## Changed files

- Modified: `components/network/galaxy/progressive-engine.ts`
- Modified: `components/network/star-atlas.tsx`
- Added: `components/network/galaxy/quality.ts`
- Added: `components/network/galaxy/quality.test.ts`
- Added: `components/network/galaxy/fallback-constellation.tsx`
- Added: `components/network/galaxy/fallback-constellation.test.tsx`

## Requirements checklist

- [x] Added focused quality-policy tests before implementation.
- [x] Added quality policy module with `GalaxyQualityProfile`, initial profile selection, and measured degradation after 120-frame samples.
- [x] Mobile starts with bounded DPR, three resident charts, reduced effects, and reduced-motion disables decorative twinkle.
- [x] Degradation lowers background density before glow/DPR and never lowers resident-chart capacity below the profile baseline.
- [x] Added `setQuality(profile)` to `ProgressiveStarEngine`.
- [x] `setQuality(profile)` updates renderer pixel ratio, background draw range, glow/twinkle shader behaviour, and transition timing without recreating word buffers.
- [x] Preserved frozen layout and screen-space picking; did not restore force layout or Raycaster picking.
- [x] Added SVG fallback constellation with stable `viewBox="0 0 1000 700"`.
- [x] Each fallback chart target is keyboard-focusable with `role="button"`, `tabIndex={0}`, chart name, and word count.
- [x] Fallback word browsing uses `GalaxyController.openChart(chartId)` and `GalaxyController.openWord(lemma)` instead of a second data path.
- [x] Fallback renders loaded chart words as a keyboard-operable list beside the SVG.
- [x] Existing StarAtlas-owned controller/search/rail/details/Run/Ladder/Tutor/full-mode surfaces remain in place.
- [x] Full 3D is disabled honestly in fallback with the exact message: `Full 3D mode is unavailable in this browser.`
- [x] Added fallback-visible focus styling, chart-load/live status text, and broader Escape handling for menus/drawers/dialogs.
- [x] Did not broaden the task into unrelated route or data changes.

## Exact verification output

### `npx vitest run components/network/galaxy/quality.test.ts components/network/galaxy/fallback-constellation.test.tsx`

```text
 RUN  v4.1.10 /Users/ericcheuk/ngsl-mood-trainer


 Test Files  2 passed (2)
      Tests  7 passed (7)
   Start at  12:32:52
   Duration  135ms (transform 53ms, setup 0ms, import 82ms, tests 12ms, environment 0ms)
```

### `npm test`

```text
> ngsl-mood-trainer@0.1.0 test
> vitest run


 RUN  v4.1.10 /Users/ericcheuk/ngsl-mood-trainer


 Test Files  17 passed (17)
      Tests  120 passed (120)
   Start at  12:34:28
   Duration  448ms (transform 501ms, setup 0ms, import 862ms, tests 342ms, environment 1ms)
```

### `npm run lint`

```text
> ngsl-mood-trainer@0.1.0 lint
> eslint

/Users/ericcheuk/ngsl-mood-trainer/lib/galaxy/build-artifacts.ts
   77:43  warning  '_xyz' is defined but never used    @typescript-eslint/no-unused-vars
  114:44  warning  '_asset' is defined but never used  @typescript-eslint/no-unused-vars

✖ 2 problems (0 errors, 2 warnings)
```

### `npm run build`

```text
> ngsl-mood-trainer@0.1.0 build
> next build

▲ Next.js 16.2.4 (Turbopack)
- Environments: .env.local, .env

  Creating an optimized production build ...
Turbopack build encountered 5 warnings:
./lib/wiki/parse-wiki.ts:67:18
The file pattern '/ROOT/wiki/pages' matches 12115 files in [project]/
  65 | }
  66 |
> 67 | const WIKI_DIR = path.join(process.cwd(), "wiki", "pages");
     |                  ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
  68 |
  69 | /** Minimal YAML-subset parse for our fixed frontmatter shape (no dependency). */
  70 | function parseFrontmatter(block: string): Record<string, string> {

Overly broad patterns can lead to build performance issues and over bundling.

Import trace:
  App Route:
    ./lib/wiki/parse-wiki.ts
    ./app/api/word/[lemma]/route.ts


./lib/wiki/parse-wiki.ts:158:28
The file pattern ('/ROOT/wiki/pages/' <dynamic> '.md' | '/ROOT/wiki/pages' <dynamic> '.md') matches 12115 files in [project]/
  156 |   if (!/^[a-z]+(['-][a-z]+)*$/.test(lemma)) return null; // guard path traversal
  157 |   try {
> 158 |     return parsePage(await readFile(path.join(WIKI_DIR, `${lemma}.md`), "utf8"));
     |                            ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
  159 |   } catch {
  160 |     return null;
  161 |   }

Overly broad patterns can lead to build performance issues and over bundling.

Import trace:
  App Route:
    ./lib/wiki/parse-wiki.ts
    ./app/api/word/[lemma]/route.ts


./lib/wiki/parse-wiki.ts:158:37
The file pattern ('/ROOT/wiki/pages/' <dynamic> '.md' | '/ROOT/wiki/pages' <dynamic> '.md') matches 24230 files in [project]/
  156 |   if (!/^[a-z]+(['-][a-z]+)*$/.test(lemma)) return null; // guard path traversal
  157 |   try {
> 158 |     return parsePage(await readFile(path.join(WIKI_DIR, `${lemma}.md`), "utf8"));
     |                                     ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
  159 |   } catch {
  160 |     return null;
  161 |   }

Overly broad patterns can lead to build performance issues and over bundling.

Import trace:
  App Route:
    ./lib/wiki/parse-wiki.ts
    ./app/api/word/[lemma]/route.ts


./lib/wiki/parse-wiki.ts:187:46
The file pattern ('/ROOT/wiki/pages/' <dynamic> | '/ROOT/wiki/pages' <dynamic>) matches 12115 files in [project]/
  185 |       files
  186 |         .slice(i, i + BATCH)
> 187 |         .map(async (file) => parsePage(await readFile(path.join(WIKI_DIR, file), "utf8"))),
     |                                              ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
  188 |     );
  189 |     for (const p of parsed) if (p) pages.push(p);
  190 |   }

Overly broad patterns can lead to build performance issues and over bundling.

Import trace:
  App Route:
    ./lib/wiki/parse-wiki.ts
    ./app/api/word/[lemma]/route.ts


./lib/wiki/parse-wiki.ts:187:55
The file pattern ('/ROOT/wiki/pages/' <dynamic> | '/ROOT/wiki/pages' <dynamic>) matches 48460 files in [project]/
  185 |       files
  186 |         .slice(i, i + BATCH)
> 187 |         .map(async (file) => parsePage(await readFile(path.join(WIKI_DIR, file), "utf8"))),
     |                                                       ^^^^^^^^^^^^^^^^^^^^^^^^^
  188 |     );
  189 |     for (const p of parsed) if (p) pages.push(p);
  190 |   }

Overly broad patterns can lead to build performance issues and over bundling.

Import trace:
  App Route:
    ./lib/wiki/parse-wiki.ts
    ./app/api/word/[lemma]/route.ts


✓ Compiled successfully in 5.2s
  Running TypeScript ...
  Finished TypeScript in 3.8s ...
  Collecting page data using 7 workers ...
  Generating static pages using 7 workers (0/18) ...
  Generating static pages using 7 workers (4/18)
  Generating static pages using 7 workers (8/18)
  Generating static pages using 7 workers (13/18)
✓ Generating static pages using 7 workers (18/18) in 195ms
  Finalizing page optimization ...

Route (app)
┌ ○ /
├ ○ /_not-found
├ ƒ /api/chat
├ ƒ /api/collect
├ ƒ /api/compose
├ ƒ /api/ladder
├ ƒ /api/me
├ ƒ /api/run
├ ƒ /api/space
├ ƒ /api/use
├ ƒ /api/word/[lemma]
└ ● /network/[listSlug]
  ├ /network/ngsl
  ├ /network/toeic
  ├ /network/business
  └ [+3 more paths]


○  (Static)   prerendered as static content
●  (SSG)      prerendered as static HTML (uses generateStaticParams)
ƒ  (Dynamic)  server-rendered on demand
```

## Task 9 review-finding fix addendum

### Findings addressed

- Preserved the exact mobile/desktop initial quality profiles for Save-Data users; Save-Data no longer performs an immediate degradation before the 120-frame sampling rule.
- Removed the conflicting parent SVG `role="img"` so fallback chart groups remain the exposed keyboard-accessible named buttons while keeping the stable `viewBox` and visible labels.
- Removed duplicate native-button keyboard activation for fallback word entries while preserving Enter/Space activation on SVG chart groups.

### Additional changed files

- Modified: `components/network/galaxy/quality.ts`
- Modified: `components/network/galaxy/quality.test.ts`
- Modified: `components/network/galaxy/fallback-constellation.tsx`
- Modified: `components/network/galaxy/fallback-constellation.test.tsx`

### Exact verification output

### `npx vitest run components/network/galaxy/quality.test.ts components/network/galaxy/fallback-constellation.test.tsx`

```text
 RUN  v4.1.10 /Users/ericcheuk/ngsl-mood-trainer


 Test Files  2 passed (2)
      Tests  9 passed (9)
   Start at  12:43:27
   Duration  402ms (transform 174ms, setup 0ms, import 300ms, tests 22ms, environment 0ms)
```

### `npm test`

```text
> ngsl-mood-trainer@0.1.0 test
> vitest run


 RUN  v4.1.10 /Users/ericcheuk/ngsl-mood-trainer


 Test Files  17 passed (17)
      Tests  122 passed (122)
   Start at  12:43:26
   Duration  643ms (transform 749ms, setup 0ms, import 1.39s, tests 433ms, environment 1ms)
```

### `npx tsc --noEmit`

```text
(no output; exited 0)
```

### `npm run lint`

```text
> ngsl-mood-trainer@0.1.0 lint
> eslint

/Users/ericcheuk/ngsl-mood-trainer/lib/galaxy/build-artifacts.ts
   77:43  warning  '_xyz' is defined but never used    @typescript-eslint/no-unused-vars
  114:44  warning  '_asset' is defined but never used  @typescript-eslint/no-unused-vars

✖ 2 problems (0 errors, 2 warnings)
```

### `git diff --check`

```text
(no output; exited 0)
```
