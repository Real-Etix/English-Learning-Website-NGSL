# Task 4 Report: Client Asset Loading, Search, and LRU Residency

## Delivered

- Added typed, abort-preserving JSON and streamed byte download helpers.
- Added a bounded chart-shard store with shared foreground-first concurrency queue, concurrent deduplication, one-time manifest refresh retry, LRU eviction, pinning, and disposal cancellation.
- Added a lazy search catalog that fetches only the search index, shares its load promise, and ranks exact, prefix, substring, and one-edit (including adjacent-transposition) matches.
- Extracted `normalizeGalaxySearch` into a node-free shared module and re-exported it from the server artifact builder. Client modules do not import `build-artifacts.ts`.

## TDD Evidence

- RED: `npx vitest run components/network/galaxy/chart-shard-store.test.ts components/network/galaxy/search-catalog.test.ts` initially failed because the loader modules did not exist.
- RED: the fuzzy-search example `spaek` initially failed, then passed after adding one-edit adjacent-transposition support.
- GREEN focused suite: 15 tests passed.

## Verification

- `npm test`: 8 files, 49 tests passed.
- `npm run lint`: 0 errors; two existing warnings remain in `lib/galaxy/build-artifacts.ts`.
- `npx tsc --noEmit`: passed.

## Important Review Fix

- Deepened `isChartShard` to validate every nested positioned-word, edge, and portal field, including finite vectors/numbers, allowed tiers, nullable ranks, and `targetChart`.
- Deepened `isSearchCatalogData` to validate every search-entry field, including `normalized`, before catalog indexing or search.
- RED: focused tests had four expected failures because malformed nested word, edge, portal, and search-entry JSON passed the fetch guards.
- GREEN: focused tests pass 19/19; malformed JSON now rejects as a decode error caused by the fetch guard, before store residency or `entry.startsWith`.

---

## Dictionary v2 Foundation — Task 4: Dictionary Quality Audit and Contract Documentation

This section records the Dictionary v2 Task 4 work. The preceding report is retained
as unrelated task-history.

### Delivered

- Added pure `auditDictionaryPages(pages)` and `hasStrictFailures(report)` with global
  and per-list page, evidence, and typed-edge coverage counts.
- Added the read-only `npm run audit:dictionary` CLI. It prints deterministic global
  and per-list totals/percentages, exits 0 for ordinary debt, and exits 1 with
  `--strict` only for placeholder definitions or LLM-only advanced pages.
- Documented wiki markdown and typed links as the source of truth; optional usage
  notes; factual-source, AI-draft, and claim-readiness rules; and the fact that the
  Free Dictionary API is not Cambridge Dictionary.

### TDD Evidence

- RED: `npx vitest run lib/wiki/dictionary-quality.test.ts` failed as expected with
  `Cannot find module './dictionary-quality'` before the production module existed.
- GREEN: the same focused command passed with 1 file and 2 tests after the minimal
  pure aggregate implementation was added.

### Verification Evidence

- `npm run audit:dictionary` exited 0 and reported 12,115 pages, 119 placeholder
  definitions, 9,465 pages without examples, 121 unknown parts of speech, 6,133
  LLM-only advanced pages, 48 zero-connection pages, and 78,103 edges.
- `npm run audit:dictionary -- --strict` exited 1 as designed, with
  `Strict audit failed: placeholder definitions or LLM-only advanced pages remain.`
- `npm test` passed: 29 files, 182 tests.
- `npx tsc --noEmit` exited 0.
- `npm run lint` exited 0; its only two warnings are pre-existing unused variables in
  `lib/galaxy/build-artifacts.ts`.
- `npm run build` exited 0. It retains existing Turbopack broad-file-pattern warnings
  from `lib/wiki/parse-wiki.ts` while compiling and generating static pages.
- `git diff --check` produced no whitespace errors. No wiki pages or galaxy assets
  were changed.

### Local Commit

- Implementation commit (not pushed): `080120eb` (`feat: add dictionary quality audit`).

### Review Fix: Duplicate List IDs

- RED: `npx vitest run lib/wiki/dictionary-quality.test.ts` failed as expected. A page
  with duplicate `ngsl` and `academic` list IDs was counted twice per list, producing
  `pages: 2` and `edges.total: 2` instead of 1.
- GREEN: after iterating distinct list IDs, the same focused suite passed: 1 file,
  3 tests.
- Verification: `npx tsc --noEmit` exited 0. `npm run lint` exited 0 with the two
  pre-existing unused-variable warnings in `lib/galaxy/build-artifacts.ts`.

### Browser Verification Limitations

- The local Next development server was started with `npm run dev -- --hostname 0.0.0.0` and returned HTTP 200 for `/network/ngsl` when checked from the same host shell.
- The required Codex in-app browser was initialized and attempted to navigate to `http://localhost:3000/network/ngsl` and the local network host. Its page remained an `ERR_CONNECTION_REFUSED` interstitial because the browser surface cannot reach the escalated local server namespace.
- Chrome/extension browser surfaces were unavailable.
- Therefore desktop/narrow visual interaction checks of this current unpushed branch could not be completed in this environment; no fabricated success is reported. Existing focused render tests, typecheck, and build are the available verification.
- The Free Dictionary fallback was not exercised in the browser because the current app could not be reached; the code-level fallback/render tests are recorded elsewhere.
