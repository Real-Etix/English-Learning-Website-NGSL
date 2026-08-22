# NDJSON vocabulary pipeline — Task 3 report

## Status

Complete. This task adds a one-time, migration-only Markdown-to-NDJSON converter.
It does not change Markdown runtime consumers and does not delete any Markdown
pages.

## TDD evidence

1. Added `lib/vocabulary/migrate-markdown.test.ts` and
   `lib/vocabulary/legacy-markdown.test.ts` before their production modules.
2. Ran `npx vitest run lib/vocabulary/migrate-markdown.test.ts`.
   - RED observed: `Cannot find module './migrate-markdown'`.
3. Implemented the migration-only parser and lossless converter.
4. Ran `npx vitest run lib/vocabulary/legacy-markdown.test.ts lib/vocabulary/migrate-markdown.test.ts`.
   - GREEN: 2 files, 4 tests passed.

## Commands and results

| Command | Result |
| --- | --- |
| `npx vitest run lib/vocabulary/legacy-markdown.test.ts lib/vocabulary/migrate-markdown.test.ts lib/vocabulary/ndjson-repository.test.ts` | Passed: 3 files, 10 tests. |
| `npx tsc --noEmit` | Passed. |
| `npm run migrate:vocabulary -- --source=wiki/pages --out=content/vocabulary` | Passed: migrated 12,115 records across 32 shards with 78,103 connections. |
| `npm run migrate:vocabulary -- --source=wiki/pages --out=content/vocabulary --force` | Passed with the same 12,115-record / 78,103-connection totals. |
| `git diff -- content/vocabulary > /tmp/vocabulary-first.diff` then forced rerun and `cmp /tmp/vocabulary-first.diff /tmp/vocabulary-second.diff` | Passed: byte-for-byte deterministic generated diff. |
| `git diff --check` | Passed. |

Vitest continues to emit the pre-existing Vite CommonJS/ESM configuration warning;
it does not affect test results.

## Generated corpus

- Records: 12,115
- Shards: 32 (`00.ndjson` through `1f.ndjson`)
- Connections: 78,103
- Source-backed records: 5,859
- Publication counts: 12,115 published, 0 draft, 0 review, 0 hidden
- List membership totals: NGSL 2,805; Academic 957; Business 1,744; TOEIC 1,248;
  Fitness 601. A record can appear in multiple lists, while advanced records have no
  list membership.
- Source registry IDs: `curated`, `dictionaryapi`, `llm`, `tatoeba`, `wordnet`.

## Changed files

- Added `lib/vocabulary/legacy-markdown.ts` and its test: isolated parser for the
  former page structure; production code does not import it.
- Added `lib/vocabulary/migrate-markdown.ts` and its test: lossless conversion,
  legacy deterministic sense IDs, per-list rank/SFI expansion, explicit example
  source suffixes, sorted structural arrays, and blank-gloss `unreviewed` links.
- Added `scripts/migrate-wiki-to-ndjson.ts`: guarded CLI, manifest, source registry,
  schema artifact, SHA-256 shard checksums, and totals.
- Added `scripts/generate-vocabulary-schema.ts`.
- Updated `package.json` with `migrate:vocabulary` and `schema:vocabulary`.
- Generated `content/vocabulary/00.ndjson` through `1f.ndjson`, `schema.json`,
  `sources.json`, and `manifest.json`.

## Concerns and deferred work

- The corpus preserves its current public visibility: all migrated records are
  initially `published` to keep migration behavior unchanged. Vocabulary v2 must
  apply the planned advanced-draft quarantine before further enrichment resumes.
- Legacy connections without a gloss are deliberately `unreviewed`. They remain in
  canonical data for graph parity but must not be learner-facing after the later
  connection-gloss gate.
- This task intentionally does not compare Markdown and NDJSON fields, switch
  runtime readers, or delete `wiki/pages`; Task 4 owns parity and later tasks own
  cutover.
- The two unrelated untracked Dictionary v2 foundation documents were not modified.
