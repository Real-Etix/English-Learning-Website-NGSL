# NDJSON Task 5 Final Report

Status: complete. No Task 6 work was started.

## Review fixes delivered

- `collectWord` now resolves the requested lemma with `openNdjsonRepository().get(lemma)` and uses the canonical record's tier, first-list SFI, and display value. The canonical-only collection regression test proves the Markdown reader is not consulted.
- `findMisplacedShardFindings` checks every physical `00.ndjson` through `1f.ndjson` file and compares each parsed record's actual filename with `shardIdForLemma(record.lemma)`. The helper and wrong-physical-shard regression test are retained.
- `loadListGraph` retains the no-fallback generated-artifact error. The missing-graph regression test is retained.
- Canonical migration no longer sorts a record's connections. It preserves the deterministic authored Markdown order; the `a` regression covers `lot`, `one`, `any`, `some`, `few`, `namely` in that exact order.
- The graph builder retains the legacy Markdown filename ordering and Louvain/folding/hub tie semantics from `16b17d02^:lib/wiki/parse-wiki.ts`. It does not use `record.chart` to assign charts.

## RED / GREEN evidence

- RED: the new authored-connection-order migration test failed against the sorted canonical output, receiving `any, few, lot, namely, one, some` instead of the authored sequence.
- GREEN: after removing only the connection sort, `npx vitest run lib/vocabulary/migrate-markdown.test.ts` passed: 4 tests.
- Focused Task 5 suite passed: `npx vitest run lib/vocabulary/graph.test.ts lib/collection/service.test.ts scripts/lint-vocabulary.test.ts lib/wiki/graph-store.test.ts lib/vocabulary/migrate-markdown.test.ts` — 5 files, 15 tests.

## Regeneration and validation

- `npm run migrate:vocabulary -- --source=wiki/pages --out=content/vocabulary --force` regenerated all 32 shards and manifest: 12,115 records and 78,103 connections.
- `npm run build:graphs` regenerated all graph JSON and galaxy assets.
- `npx tsc --noEmit` passed.
- `npm run lint:vocabulary` passed: 12,115 records, 0 errors, 0 warnings.
- `npm run audit:dictionary` passed: 12,115 pages and 78,103 edges.
- `npm run validate:vocabulary-migration` passed: 12,115 legacy records and 12,115 canonical records.
- `git diff --check` and `git diff --cached --check` both passed.

## Exact historical graph comparison

The rebuilt graph JSON was compared directly to `git show 16b17d02:data/generated/graphs/<slug>.json`. For every list, node count, edge count, isolation count, and the complete lemma-to-chart mapping are exactly equal.

| List | Nodes | Edges | Isolated | Chart assignment |
| --- | ---: | ---: | ---: | --- |
| academic | 3,674 | 9,642 | 2 | exact |
| all | 12,115 | 54,502 | 45 | exact |
| business | 6,036 | 20,690 | 6 | exact |
| fitness | 2,065 | 4,004 | 42 | exact |
| ngsl | 8,645 | 37,143 | 6 | exact |
| toeic | 4,387 | 12,091 | 4 | exact |

## Scope and handoff

- The commit contains only Task 5 code, tests, canonical shard/manifest changes, rebuilt graph artifacts, rebuilt galaxy assets/manifests, and this report.
- The two unrelated untracked Dictionary v2 foundation documents remain unmodified and unstaged.
- No remote push was performed.
