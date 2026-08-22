# Task 2 implementation report: Shards, Search Catalog, and Full Binary

## Status

Implemented against base commit `c5139bf76dfd2d19817a6e00c96a2f76301f4ecf` in the shared repository.

## Delivered files

- `lib/galaxy/full-codec.ts`
- `lib/galaxy/full-codec.test.ts`
- `lib/galaxy/build-artifacts.ts`
- `lib/galaxy/build-artifacts.test.ts`

## Implementation details

### Full binary codec

- Defines the exported `FullGalaxyData` contract.
- Encodes the exact `SAT1` format: four-byte magic, little-endian JSON-header length, four-byte header alignment, `Float32` positions, `Uint8` tiers, aligned `Int32` ranks, and `Uint16` degrees.
- Stores only version, list slug, and word metadata in the JSON header; graph edges and definitions are absent from the full payload.
- Validates all typed-array cardinalities on encode and decode, validates metadata fields, verifies magic/header structure, bounds-checks every typed-view range before construction, and rejects malformed content with `Invalid full galaxy payload`.
- Supports both `ArrayBuffer` and `SharedArrayBuffer` input typing so normal typed-array buffer slices type-check under the project TypeScript version.

### Artifact builder

- Uses Task 1's `layoutGalaxy` for frozen positioned output.
- Computes the required graph version with `sha256(JSON.stringify(graph)).slice(0, 16)`.
- Builds one shard per positioned chart, keeps intra-chart edges local, and mirrors cross-chart portals with reversed endpoints in the destination chart.
- Emits a normalized, display-then-lemma sorted search catalog containing every positioned word.
- Builds one binary full asset from words, frozen positions, tier encoding (`core = 0`, `advanced = 1`), ranks (`null = -1`), and degrees.
- Content-hashes JSON/binary bytes into immutable `/generated/galaxy/assets/` URLs and supplies direct asset byte counts on manifest charts and shared assets.
- Derives manifest list counts from positioned words, retaining Drift as an asset while excluding it from `chartCount` and including its words in `driftCount`.

## TDD evidence

1. Initial RED command:
   `npx vitest run lib/galaxy/full-codec.test.ts lib/galaxy/build-artifacts.test.ts`
   failed as expected because `./full-codec` and `./build-artifacts` did not exist.
2. An additional malformed-word-metadata regression test failed before the validation fix with `Cannot read properties of null`, rather than the required full-galaxy validation error.
3. After implementation and the validation fix, the focused suite passed.

## Final verification

- `npx vitest run lib/galaxy/full-codec.test.ts lib/galaxy/build-artifacts.test.ts lib/galaxy/layout.test.ts` — 3 files passed, 7 tests passed.
- `npx tsc --noEmit` — passed with exit code 0.
- `git diff --check` — passed before commit preparation.

## Review-finding fixes

- Replaced the search catalog's default-locale `localeCompare` calls with an ordinal `<`/`>` comparator for both normalized display and lemma tie-breaking. Search JSON bytes, content hashes, and URLs are therefore independent of the build host's locale.
- Added a Unicode search-order regression using `Åland`, `Zulu`, and `Æther`. Before the fix, the host's `en-US` collation produced `Æther, Åland, Zulu`; the asserted ordinal order is `Åland, Zulu, Æther`.
- Split codec corruption coverage into a bad-magic test built from an otherwise valid encoded payload and a separate test that removes one byte from a valid `SAT1` payload.

### Fix TDD evidence

1. RED: `npx vitest run lib/galaxy/build-artifacts.test.ts lib/galaxy/full-codec.test.ts` failed only the new Unicode ordering test, receiving `Æther, Åland, Zulu` instead of `Åland, Zulu, Æther`; the two distinct codec regressions passed.
2. GREEN: after adding the ordinal comparator, the same focused command passed 2 files and 6 tests.
3. Verification: `npx tsc --noEmit` and `git diff --check` both passed with exit code 0 after correcting the test fixture to satisfy mutable `LiteGraph` typing.

## Second re-review: inherited layout determinism

- Inspected every sort on the Task 1+2 galaxy path. `layout.ts` had four default-locale comparisons: equal-sized chart IDs, equal-degree member lemmas, equal-weight chart-link source IDs, and equal-weight neighbor chart IDs. The remaining argument-less two-value `.sort()` is specified ordinal UTF-16 ordering and is not locale-sensitive.
- Replaced all four `localeCompare` calls with explicit ordinal `<`/`>` comparison, matching the artifact search comparator.
- Added an integration regression with the Unicode chart IDs `zulu`, `äther`, and `øzone`, plus Unicode member lemmas. It builds both `layoutGalaxy` and the complete `GalaxyArtifactBundle` while simulating `en-US` and `sv-SE` host collations, then compares the complete outputs and asserts ordinal chart, word, chart-link, and neighbor ordering.

### Second-fix TDD and verification evidence

1. RED: `npx vitest run lib/galaxy/build-artifacts.test.ts` failed the new cross-collation test. The diff showed chart order, frozen coordinates, shard/full bytes, content hashes, URLs, chart links, and neighbors changing between `en-US` and `sv-SE`.
2. GREEN: after replacing all four layout comparisons, the same test file passed 3 tests.
3. Full Task 1+2 verification: `npx vitest run lib/galaxy/layout.test.ts lib/galaxy/full-codec.test.ts lib/galaxy/build-artifacts.test.ts` passed 3 files and 10 tests; `npx tsc --noEmit` and `git diff --check` passed with exit code 0.
4. Residual scan: `rg -n "localeCompare" lib/galaxy --glob '*.ts'` finds only the regression harness that simulates two host collations, and no production use.

## Scope and concerns

- No files outside `lib/galaxy` were modified and no generated assets were added; Task 3 owns writing artifact files into `public/generated`.
- The builder intentionally uses `node:crypto`: it is a build-time/server utility that Task 3's generator will call, rather than a Client Component dependency.

---

# Dictionary v2 Foundation Task 2: Word API, Tutor Grounding, and Safe Composition Context

## Scope

- `app/api/word/[lemma]/route.ts`
- `lib/content/tutor-context.ts`
- `lib/content/tutor-context.test.ts`
- `app/api/chat/route.ts`
- `app/api/compose/route.ts`
- `lib/compose/tasks.ts`
- `lib/compose/tasks.test.ts`

## RED

1. Added tutor-context tests before creating the production module. The test asserted normalized word metadata/evidence, bounded primary and additional meanings, three sourced examples, an authored usage note, the verbatim explained connection gloss, exclusion of an unexplained target, the twelve-connection cap, the AI-draft label, and the exact final non-invention guard.
2. Added `pickTask` tests before modifying task selection. They asserted that a higher-priority partner with a null gloss is skipped and that returned definitions exactly match the definitions supplied to `pickTask`.
3. Ran `npx vitest run lib/content/tutor-context.test.ts lib/compose/tasks.test.ts` before implementation. It failed as expected: `./tutor-context` was absent, and `pickTask` selected `unglossed` rather than the explained partner.

## GREEN

1. Implemented deterministic `buildTutorStarContext(profile)`. It emits metadata/evidence, at most four senses, at most three source-labelled examples, the optional authored usage note, and at most twelve `explained === true` relations. Relation glosses are rendered without alteration, unexplained edges are omitted, and the context ends exactly with `Do not invent missing usage guidance or relationships.`
2. Added `learning` to the word API response while retaining raw `page`, `detail`, and `rarity`; dictionary detail and rarity remain parallel.
3. Updated chat to demand-load dictionary detail, build the normalized profile, and ground the model only in tutor context. The existing rate limiter and eight-message history truncation remain unchanged.
4. Updated `pickTask` to require a non-blank authored relation gloss.
5. Updated compose so dictionary detail is fetched in parallel only after a target/partner pair is selected. It replaces task definitions with normalized primary meanings where available and retains existing wiki definitions as the fallback.
6. Ran `npx vitest run lib/content/tutor-context.test.ts lib/compose/tasks.test.ts` after implementation: 2 files passed, 4 tests passed.

## Verification

- `npx vitest run lib/content/tutor-context.test.ts lib/content/word-learning.test.ts lib/compose/tasks.test.ts` — 3 files passed, 18 tests passed.
- `npx tsc --noEmit` — passed with exit code 0.
- `npm run lint` — passed with 0 errors; it reports two existing warnings in out-of-scope `lib/galaxy/build-artifacts.ts` for unused `_xyz` and `_asset` parameters.
- `git diff --check` — passed for the scoped changes.
- Scoped spec/diff review verified the required response compatibility, context bounds/guard, explained-only relation handling, rate-limit/history preservation, selected-pair-only parallel detail fetches, and wiki fallback. An independent Codex reviewer was attempted in read-only mode, but the platform blocked it because it would transmit private workspace contents externally; no source code was sent and no reviewer mutation occurred.
