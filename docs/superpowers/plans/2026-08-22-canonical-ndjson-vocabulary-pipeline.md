# Canonical NDJSON Vocabulary Pipeline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace 12,115 active Markdown vocabulary pages with 32 deterministic NDJSON shards, preserve graph and API behavior, and move production enrichment to reviewed GitHub Actions pull requests.

**Architecture:** Git remains the vocabulary source of truth. A Zod-validated NDJSON repository feeds generated graph and word-detail artifacts; PostgreSQL remains limited to user/social state. The migration keeps Markdown and NDJSON side by side until field, audit, graph, API, and build parity pass, then removes Markdown in a separate cutover commit.

**Tech Stack:** TypeScript 5, Node.js crypto/fs streams, Zod 4.3, Vitest 4, Next.js 16.2 App Router, GitHub Actions, existing graph/artifact builders.

## Global Constraints

- Preserve authored definitions, examples, usage notes, and connection glosses verbatim; structural newline normalization is the only permitted text change.
- Use exactly 32 shards named `00.ndjson` through `1f.ndjson`.
- Compute the shard as `sha256(normalizedLemma)[0] & 31` and sort records by normalized lemma.
- Keep NDJSON as the only editable vocabulary source after cutover; do not add vocabulary tables to Prisma/PostgreSQL.
- Keep existing generated galaxy formats compatible with the progressive loader.
- Do not create unsupported advanced words while porting enrichment.
- Production automation may open a pull request but may not push directly to the default branch.
- Do not delete Markdown until migration parity, tests, lint, typecheck, graph generation, and production build pass.
- Read Next.js behavior from `node_modules/next/dist/docs/` before changing route handlers; route params are asynchronous in this version.
- Commit after every task and do not push remote branches unless the user explicitly authorizes it.

---

### Task 1: Canonical Vocabulary Types and Stable Sharding

**Files:**
- Create: `lib/vocabulary/schema.ts`
- Create: `lib/vocabulary/shards.ts`
- Create: `lib/vocabulary/test-fixtures.ts`
- Test: `lib/vocabulary/schema.test.ts`
- Test: `lib/vocabulary/shards.test.ts`

**Interfaces:**
- Produces: `VocabularyRecordSchema`, `VocabularyRecord`, `VocabularySense`, `VocabularyConnection`, `ContentSourceRef`, `PublicationStatus`.
- Produces: `normalizeVocabularyLemma(value: string): string` and `shardIdForLemma(lemma: string): string`.
- Later tasks must import these types rather than redefining Markdown-shaped content.

- [ ] **Step 1: Write schema and shard RED tests**

```ts
// lib/vocabulary/shards.test.ts
import { describe, expect, it } from "vitest";
import { normalizeVocabularyLemma, shardIdForLemma } from "./shards";

describe("stable vocabulary shards", () => {
  it("normalizes and assigns stable SHA-256 shards", () => {
    expect(normalizeVocabularyLemma("  Bank  ")).toBe("bank");
    expect(shardIdForLemma("bank")).toBe("03");
    expect(shardIdForLemma("get")).toBe("09");
    expect(shardIdForLemma("academic")).toBe("18");
  });
});
```

```ts
// lib/vocabulary/schema.test.ts
import { describe, expect, it } from "vitest";
import { VocabularyRecordSchema } from "./schema";
import { vocabularyRecordFixture } from "./test-fixtures";

describe("VocabularyRecordSchema", () => {
  it("accepts a complete v1 record and rejects an invalid publication state", () => {
    expect(VocabularyRecordSchema.safeParse(vocabularyRecordFixture()).success).toBe(true);
    expect(VocabularyRecordSchema.safeParse({
      ...vocabularyRecordFixture(), publicationStatus: "visible",
    }).success).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests and confirm RED**

Run: `npx vitest run lib/vocabulary/schema.test.ts lib/vocabulary/shards.test.ts`

Expected: FAIL because `schema.ts`, `shards.ts`, and `test-fixtures.ts` do not exist.

- [ ] **Step 3: Implement exact v1 types and validation**

Use Zod enums for every bounded field and `.strict()` for persisted objects. Export inferred TypeScript types. Validate finite ranks/SFI, normalized non-empty lemmas, non-empty sense definitions, source IDs, and connection targets. Implement sharding with:

```ts
import { createHash } from "node:crypto";

export function normalizeVocabularyLemma(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

export function shardIdForLemma(lemma: string): string {
  const normalized = normalizeVocabularyLemma(lemma);
  if (!normalized) throw new Error("Vocabulary lemma cannot be empty");
  const byte = createHash("sha256").update(normalized, "utf8").digest()[0];
  return (byte & 31).toString(16).padStart(2, "0");
}
```

`vocabularyRecordFixture()` must return one valid, source-backed core record with one sense, one sourced example, and one explained connection. Keep fixture text fixed so later deterministic tests can reuse it.

- [ ] **Step 4: Run focused GREEN verification**

Run: `npx vitest run lib/vocabulary/schema.test.ts lib/vocabulary/shards.test.ts`

Expected: 2 test files pass.

- [ ] **Step 5: Run typecheck and commit**

Run: `npx tsc --noEmit`

```bash
git add lib/vocabulary/schema.ts lib/vocabulary/shards.ts lib/vocabulary/test-fixtures.ts lib/vocabulary/schema.test.ts lib/vocabulary/shards.test.ts
git commit -m "feat: define canonical vocabulary records"
```

---

### Task 2: Streaming NDJSON Repository and Atomic Shard Writer

**Files:**
- Create: `lib/vocabulary/repository.ts`
- Create: `lib/vocabulary/ndjson-repository.ts`
- Create: `lib/vocabulary/ndjson-repository.test.ts`

**Interfaces:**
- Consumes: `VocabularyRecord`, `VocabularyRecordSchema`, `shardIdForLemma` from Task 1.
- Produces: `VocabularyRepository` with `get`, `all`, and `list`.
- Produces: `openNdjsonRepository(root?: string): VocabularyRepository`.
- Produces: `writeVocabularyRecords(root: string, updates: VocabularyRecord[]): Promise<string[]>`, returning changed shard IDs.

- [ ] **Step 1: Write repository RED tests**

Use `mkdtemp`, write two unsorted fixture lines to different shards, and assert:

```ts
const repository = openNdjsonRepository(root);
expect((await repository.get("bank"))?.display).toBe("bank");
expect(await collect(repository.all())).toEqual(
  expect.arrayContaining([expect.objectContaining({ lemma: "bank" })]),
);
expect((await collect(repository.list("ngsl"))).map((word) => word.lemma)).toContain("bank");
```

Add an update test that writes `zebra` and `bank`, then asserts every changed shard is sorted, ends in one newline, validates on reread, and an identical second write returns `[]`.

- [ ] **Step 2: Run the focused test and confirm RED**

Run: `npx vitest run lib/vocabulary/ndjson-repository.test.ts`

Expected: FAIL because the repository modules do not exist.

- [ ] **Step 3: Implement line-by-line reads and per-shard caching**

Implement `get` by calculating one shard and parsing only that file. Implement `all` and `list` as async generators. Parse every non-empty line with `VocabularyRecordSchema.parse`; include file and line number in thrown decode errors. Cache shard promises per repository instance, and expose no mutable arrays.

- [ ] **Step 4: Implement atomic deterministic writes**

For each affected shard:

1. load existing records into a map by normalized lemma;
2. apply updates and reject duplicate update lemmas;
3. sort by normalized lemma;
4. serialize each record with `JSON.stringify(record)` plus `\n`;
5. skip the write when bytes are unchanged;
6. write `<shard>.ndjson.tmp-<pid>` in the same directory;
7. rename the temporary file over the destination;
8. remove the temporary file in `finally` when rename did not complete.

Do not use locale-dependent sorting.

- [ ] **Step 5: Run focused GREEN and static verification**

Run: `npx vitest run lib/vocabulary/ndjson-repository.test.ts`

Run: `npx tsc --noEmit`

Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add lib/vocabulary/repository.ts lib/vocabulary/ndjson-repository.ts lib/vocabulary/ndjson-repository.test.ts
git commit -m "feat: add deterministic ndjson vocabulary store"
```

---

### Task 3: One-time Markdown-to-NDJSON Converter

**Files:**
- Create: `lib/vocabulary/legacy-markdown.ts`
- Create: `lib/vocabulary/legacy-markdown.test.ts`
- Create: `lib/vocabulary/migrate-markdown.ts`
- Create: `lib/vocabulary/migrate-markdown.test.ts`
- Create: `scripts/migrate-wiki-to-ndjson.ts`
- Create: `scripts/generate-vocabulary-schema.ts`
- Modify: `package.json`
- Generate: `content/vocabulary/00.ndjson` through `content/vocabulary/1f.ndjson`
- Generate: `content/vocabulary/schema.json`
- Generate: `content/vocabulary/sources.json`
- Generate: `content/vocabulary/manifest.json`

**Interfaces:**
- Produces: `parseLegacyMarkdownPage(raw: string): WikiPage | null` in a migration-only module.
- Consumes: raw Markdown through `parseLegacyMarkdownPage` only during migration.
- Produces: `convertLegacyMarkdown(raw: string): VocabularyRecord | null`.
- Produces CLI: `npm run migrate:vocabulary -- --source=wiki/pages --out=content/vocabulary`.

- [ ] **Step 1: Write conversion RED tests with exact authored text**

Use a fixture containing two example source suffixes, a usage note, duplicate list IDs, an em-dash gloss, SFI, chart, and region. Assert:

```ts
const record = convertLegacyMarkdown(markdown)!;
expect(record.senses[0].definition).toBe("A place that keeps and lends money.");
expect(record.senses[0].examples).toEqual([
  expect.objectContaining({ text: "She deposited the cheque at the bank." }),
]);
expect(record.connections[0]).toMatchObject({
  target: "deposit", type: "collocation", gloss: "money is deposited at a bank",
});
expect(record.lists.map((entry) => entry.id)).toEqual(["business", "ngsl"]);
```

Also assert an empty or malformed page returns `null` and conversion never invents future usage patterns or mistakes.

- [ ] **Step 2: Run conversion test and confirm RED**

Run: `npx vitest run lib/vocabulary/migrate-markdown.test.ts`

Expected: FAIL because the migration module does not exist.

- [ ] **Step 3: Isolate and implement lossless legacy conversion**

Copy the Markdown parsing behavior needed by the converter into
`lib/vocabulary/legacy-markdown.ts`; production code must not import this module. Use
`parseLegacyMarkdownPage` for structural fields, but parse raw `## Examples` lines
separately so source suffixes are not discarded. Map legacy source IDs to
`ContentSourceRef`; when an example has an explicit suffix, attach that source,
otherwise attach the page's factual source references without inventing a provider.
Create a deterministic legacy sense ID from lemma, POS, definition, and source IDs.

Map old rank/SFI to every distinct list entry because the Markdown source contains only one merged rank/SFI pair. Sort list IDs, forms, domains, and connections deterministically without changing authored strings.

Map a legacy connection to `status: "published"` only when its gloss is non-empty;
map a blank-gloss connection to `status: "unreviewed"` so it cannot become
learner-facing merely because it existed in Markdown.

- [ ] **Step 4: Implement migration CLI and manifest generation**

The CLI must refuse to overwrite a non-empty output directory unless `--force` is present, write all 32 shards through `writeVocabularyRecords`, emit `sources.json`, and calculate per-shard SHA-256/bytes/count plus global/per-list totals. Generate `schema.json` with `z.toJSONSchema(VocabularyRecordSchema)`.

Add scripts:

```json
{
  "migrate:vocabulary": "tsx scripts/migrate-wiki-to-ndjson.ts",
  "schema:vocabulary": "tsx scripts/generate-vocabulary-schema.ts"
}
```

- [ ] **Step 5: Run focused tests and a dry migration**

Run: `npx vitest run lib/vocabulary/migrate-markdown.test.ts lib/vocabulary/ndjson-repository.test.ts`

Run: `npm run migrate:vocabulary -- --source=wiki/pages --out=content/vocabulary`

Expected: the command reports exactly 32 shards, 12,115 current records, and the current connection total; if the corpus changed, record the newly audited exact totals rather than forcing the old number.

- [ ] **Step 6: Validate deterministic rerun**

Run: `git diff -- content/vocabulary > /tmp/vocabulary-first.diff`

Run the migration again with `--force`, then run: `git diff -- content/vocabulary > /tmp/vocabulary-second.diff`

Run: `cmp /tmp/vocabulary-first.diff /tmp/vocabulary-second.diff`

Expected: exit 0.

- [ ] **Step 7: Commit source shards and converter**

```bash
git add lib/vocabulary/legacy-markdown.ts lib/vocabulary/legacy-markdown.test.ts lib/vocabulary/migrate-markdown.ts lib/vocabulary/migrate-markdown.test.ts scripts/migrate-wiki-to-ndjson.ts scripts/generate-vocabulary-schema.ts content/vocabulary package.json
git commit -m "feat: migrate vocabulary source to ndjson"
```

---

### Task 4: Field, Audit, and Graph Parity Gate

**Files:**
- Create: `lib/vocabulary/parity.ts`
- Create: `lib/vocabulary/parity.test.ts`
- Create: `scripts/validate-vocabulary-migration.ts`
- Generate: `data/generated/vocabulary-migration-report.json`
- Modify: `package.json`

**Interfaces:**
- Produces: `compareLegacyAndCanonical(legacy: WikiPage[], canonical: VocabularyRecord[]): MigrationParityReport`.
- Produces: `assertMigrationParity(report: MigrationParityReport): void`.
- Produces CLI: `npm run validate:vocabulary-migration`.

- [ ] **Step 1: Write parity RED tests**

Create matching one-word legacy/canonical fixtures and assert `ok: true`. Then change one definition, remove one example, alter one gloss, and remove one list in separate cases; assert each case reports the exact lemma and field path.

```ts
expect(report.mismatches).toContainEqual({
  lemma: "bank", field: "senses[0].definition", legacy: "old", canonical: "changed",
});
```

- [ ] **Step 2: Run test and confirm RED**

Run: `npx vitest run lib/vocabulary/parity.test.ts`

Expected: FAIL because `parity.ts` does not exist.

- [ ] **Step 3: Implement canonical projections and checksums**

Compare normalized structural arrays but exact authored text. Include totals and per-list counts, duplicate lemmas, connections by type, unknown POS, placeholders, missing examples, sources, chart/region, and SHA-256 content hashes. Sort mismatch output by lemma then field so the report is deterministic.

- [ ] **Step 4: Add graph structural parity**

Build a legacy graph and a canonical projection graph for all six slugs. Compare sorted nodes and edges while excluding only object identity and map insertion order. A changed chart, node, edge, rank, or display must fail.

- [ ] **Step 5: Implement and run the parity CLI**

Add:

```json
"validate:vocabulary-migration": "tsx scripts/validate-vocabulary-migration.ts"
```

Run: `npm run validate:vocabulary-migration`

Expected: exit 0, `ok: true`, and a deterministic report written to `data/generated/vocabulary-migration-report.json`.

- [ ] **Step 6: Commit**

```bash
git add lib/vocabulary/parity.ts lib/vocabulary/parity.test.ts scripts/validate-vocabulary-migration.ts data/generated/vocabulary-migration-report.json package.json
git commit -m "test: prove vocabulary migration parity"
```

---

### Task 5: Switch Graph, Chart, Collection, and Audit Consumers

**Files:**
- Create: `lib/vocabulary/graph.ts`
- Create: `lib/vocabulary/graph-input.ts`
- Create: `lib/vocabulary/graph.test.ts`
- Create: `scripts/lint-vocabulary.ts`
- Modify: `lib/wiki/parse-wiki.ts` (remove graph responsibilities; retain only until Task 9)
- Modify: `lib/wiki/graph-store.ts`
- Modify: `lib/wiki/dictionary-quality.ts`
- Modify: `lib/wiki/dictionary-quality.test.ts`
- Modify: `scripts/build-graph-data.ts`
- Modify: `scripts/build-charts.ts`
- Modify: `scripts/name-charts.ts`
- Retain: `scripts/lint-wiki.ts` (legacy migration comparison only; delete in Task 9)
- Modify: `scripts/audit-dictionary.ts`
- Modify: `scripts/seed-spaces.ts`
- Modify: `lib/collection/service.ts`

**Interfaces:**
- Consumes: `VocabularyRepository` and canonical records.
- Produces: storage-neutral `GraphNode`, `GraphEdge`, `ListGraph`, `LiteGraph`, `buildListGraph`, and `toLiteGraph` from `lib/vocabulary/graph.ts`.
- Renames CLI behavior to `lint:vocabulary` while keeping `audit:dictionary` output compatible.

- [ ] **Step 1: Move existing graph tests to a storage-neutral fixture**

Copy graph assertions from `lib/wiki/parse-wiki.test.ts` into `lib/vocabulary/graph.test.ts`, replacing Markdown fixture construction with `vocabularyRecordFixture()` overrides. Assert list purity, advanced targets, bridge rules, isolated counts, Louvain chart stability, and edge deduplication.

- [ ] **Step 2: Run graph tests and confirm RED**

Run: `npx vitest run lib/vocabulary/graph.test.ts`

Expected: FAIL because `lib/vocabulary/graph.ts` does not exist.

- [ ] **Step 3: Extract graph construction from Markdown parsing**

Move graph-only types/functions out of `parse-wiki.ts`. Add `toGraphInput(record)` that maps the canonical primary sense, list IDs, rank/SFI, chart, domains, and connections without reading source files. Keep `parse-wiki.ts` as a migration-only legacy reader until Task 9.

- [ ] **Step 4: Switch build and server graph consumers**

Replace `readAllPages()` calls with `openNdjsonRepository().all()` collection. Remove the runtime fallback in `lib/wiki/graph-store.ts`; missing generated graph JSON must throw a clear build/deployment error instead of scanning canonical source on a request.

- [ ] **Step 5: Port lint and audit to canonical records**

Rename the lint implementation to `scripts/lint-vocabulary.ts`. Validate schema, shard placement, source IDs, duplicate list IDs, dangling targets, allowed edge types, and reciprocity. Adapt dictionary-quality aggregation to primary canonical senses and distinct list IDs while preserving existing metric names during migration.

Add:

```json
"lint:vocabulary": "tsx scripts/lint-vocabulary.ts"
```

- [ ] **Step 6: Verify all affected consumers**

Run: `npx vitest run lib/vocabulary/graph.test.ts lib/wiki/dictionary-quality.test.ts lib/collection/xp.test.ts lib/galaxy/build-artifacts.test.ts`

Run: `npm run lint:vocabulary`

Run: `npm run audit:dictionary`

Run: `npm run build:graphs`

Expected: all pass and graph counts match the parity report.

- [ ] **Step 7: Commit**

```bash
git add lib/vocabulary/graph.ts lib/vocabulary/graph-input.ts lib/vocabulary/graph.test.ts lib/wiki/parse-wiki.ts lib/wiki/graph-store.ts lib/wiki/dictionary-quality.ts lib/wiki/dictionary-quality.test.ts scripts/build-graph-data.ts scripts/build-charts.ts scripts/name-charts.ts scripts/lint-vocabulary.ts scripts/audit-dictionary.ts scripts/seed-spaces.ts lib/collection/service.ts package.json
git commit -m "refactor: build vocabulary graph from ndjson"
```

---

### Task 6: Generated Word Store and API Cutover

**Files:**
- Create: `scripts/build-word-data.ts`
- Create: `lib/vocabulary/generated-word-store.ts`
- Create: `lib/vocabulary/generated-word-store.test.ts`
- Create: `lib/vocabulary/legacy-profile-adapter.ts`
- Modify: `lib/content/word-learning.ts`
- Modify: `lib/content/word-learning.test.ts`
- Modify: `app/api/word/[lemma]/route.ts`
- Modify: `app/api/chat/route.ts`
- Modify: `app/api/compose/route.ts`
- Modify: `components/network/word-learning-response.ts`
- Modify: `components/network/word-learning-response.test.ts`
- Modify: `package.json`
- Generate: `data/generated/vocabulary/manifest.json`
- Generate: `data/generated/vocabulary/words-00.json` through `words-1f.json`

**Interfaces:**
- Produces: `loadGeneratedWord(lemma: string): Promise<VocabularyRecord | null>`.
- Produces: `buildWordLearningProfile(record: VocabularyRecord, detail: WordDetail | null): WordLearningProfile`.
- Keeps `/api/word/[lemma]` response keys `page`, `detail`, `learning`, and `rarity` compatible during frontend migration.

- [ ] **Step 1: Write generated-store RED tests**

Write a temporary `words-03.json` object keyed by lemma and assert `bank` loads, an invalid lemma returns `null`, an invalid record rejects, and requesting `get` does not read another shard. Use an injected `readFile` spy rather than relying on timing.

- [ ] **Step 2: Run test and confirm RED**

Run: `npx vitest run lib/vocabulary/generated-word-store.test.ts`

Expected: FAIL because the generated store does not exist.

- [ ] **Step 3: Build deterministic published word shards**

`build-word-data.ts` reads canonical records, groups by shard, writes one JSON object per shard, and writes a checksum manifest. Include all currently visible records during parity migration. Do not include enrichment-only metadata that the API never uses.

Add the word build before galaxy assets:

```json
{
  "build:vocabulary": "tsx scripts/build-word-data.ts",
  "build:graphs": "tsx scripts/build-word-data.ts && tsx scripts/build-graph-data.ts && tsx scripts/build-galaxy-assets.ts"
}
```

- [ ] **Step 4: Adapt learning profiles without changing learner behavior**

Map canonical primary definition/examples/sources to the existing normalized profile. Continue demand-loading Free Dictionary detail during this migration so multiple senses/audio do not regress. Keep the six-sense limit, source precedence, claim block reasons, and connection glosses unchanged.

- [ ] **Step 5: Switch route handlers from Markdown reads**

In all three routes, replace `readPage` with `loadGeneratedWord`. Preserve `export const runtime = "nodejs"` and asynchronous route params. Use `toLegacyPage(record)` only for the temporary `page` compatibility field; tutor and composition logic must consume canonical records through the profile builder.

- [ ] **Step 6: Verify API/profile compatibility**

Run: `npx vitest run lib/vocabulary/generated-word-store.test.ts lib/content/word-learning.test.ts components/network/word-learning-response.test.ts lib/content/tutor-context.test.ts lib/compose/tasks.test.ts`

Run: `npx tsc --noEmit`

Run: `npm run build:graphs`

Run: `npm run build`

Expected: all pass; Next build no longer reports broad `wiki/pages` tracing warnings from the word route.

- [ ] **Step 7: Commit**

```bash
git add scripts/build-word-data.ts lib/vocabulary/generated-word-store.ts lib/vocabulary/generated-word-store.test.ts lib/vocabulary/legacy-profile-adapter.ts lib/content/word-learning.ts lib/content/word-learning.test.ts app/api/word/'[lemma]'/route.ts app/api/chat/route.ts app/api/compose/route.ts components/network/word-learning-response.ts components/network/word-learning-response.test.ts data/generated/vocabulary package.json
git commit -m "feat: serve word learning data from generated vocabulary"
```

---

### Task 7: Port Enrichment and Clipping to Validated Shard Updates

**Files:**
- Create: `lib/vocabulary/enrichment/apply-proposals.ts`
- Create: `lib/vocabulary/enrichment/apply-proposals.test.ts`
- Create: `scripts/enrich-vocabulary.ts`
- Modify: `scripts/enrich-links.ts`
- Modify: `scripts/ingest-clips.ts`
- Modify: `package.json`

**Interfaces:**
- Produces: `applyVocabularyProposals(records, proposals): ApplyProposalResult`.
- Produces CLI: `npm run enrich:vocabulary -- --list=<slug> --limit=<n> [--dry-run]`.
- Unknown advanced suggestions are reported but never created in this plan.

- [ ] **Step 1: Write proposal safety RED tests**

Assert that an existing-word connection proposal updates one record with
`status: "unreviewed"`, a repeated proposal is idempotent, an unknown target is rejected,
and a proposal cannot overwrite a verified definition.

```ts
expect(result.rejected).toContainEqual({
  lemma: "buy", reason: "unknown target: procure",
});
```

- [ ] **Step 2: Run test and confirm RED**

Run: `npx vitest run lib/vocabulary/enrichment/apply-proposals.test.ts`

Expected: FAIL because proposal application is not implemented.

- [ ] **Step 3: Implement validated existing-record proposals**

Require lemma/target existence, allowed edge type, non-empty proposed gloss, and source marker `llm`. Deduplicate by source lemma, target, and type. Return changed records and structured rejection reasons; do not write files inside the pure function.

- [ ] **Step 4: Port scripts to the repository writer**

Replace `appendConnection`, `newAdvancedPage`, and direct `wiki/pages` writes. Keep
the existing Chrome extension and `/api/clips` capture contract unchanged. Keep clip
candidates and provenance in the existing `wiki/raw/` inbox/archive during this
migration; write unknown words to `wiki/raw/unresolved.json`. The ingest script may
not create an advanced record until Vocabulary v2 rules are implemented.

Add:

```json
"enrich:vocabulary": "tsx scripts/enrich-vocabulary.ts"
```

- [ ] **Step 5: Verify dry-run and idempotence**

Run: `npm run enrich:vocabulary -- --list=ngsl --limit=3 --dry-run`

Expected: prints selected lemmas and proposed/rejected counts, changes no tracked files, and exits 0 even without an API key by reporting enrichment unavailable.

Run the focused test twice and confirm the second proposal application reports zero changes.

- [ ] **Step 6: Commit**

```bash
git add lib/vocabulary/enrichment/apply-proposals.ts lib/vocabulary/enrichment/apply-proposals.test.ts scripts/enrich-vocabulary.ts scripts/enrich-links.ts scripts/ingest-clips.ts package.json
git commit -m "refactor: enrich canonical vocabulary shards"
```

---

### Task 8: GitHub Actions Enrichment Pull Requests

**Files:**
- Create: `.github/workflows/vocabulary-enrichment.yml`
- Create: `scripts/verify-enrichment-diff.ts`
- Create: `scripts/verify-enrichment-diff.test.ts`
- Modify: `README.md`

**Interfaces:**
- Workflow inputs: `list`, `limit`, `dry_run`.
- Required secret: `LLM_API_KEY`; optional variables: `LLM_BASE_URL`, `LLM_MODEL`.
- Produces one branch `automation/vocabulary-<run-id>` and one pull request only when validated files changed.

- [ ] **Step 1: Write diff-policy RED tests**

Test `verifyEnrichmentPaths(paths)` accepts only the exact generated outputs:
`content/vocabulary/(?:0[0-9a-f]|1[0-9a-f]).ndjson`,
`content/vocabulary/manifest.json`,
`data/generated/graphs/(?:academic|all|business|fitness|ngsl|toeic).json`,
`data/generated/vocabulary/manifest.json`,
`data/generated/vocabulary/words-(?:0[0-9a-f]|1[0-9a-f]).json`,
`public/generated/galaxy/manifests/(?:academic|all|business|fitness|ngsl|toeic).json`,
`public/generated/galaxy/assets/(?:academic|all|business|fitness|ngsl|toeic)-(?:chart|search)-[0-9a-f]{12}.json`,
and `public/generated/galaxy/assets/(?:academic|all|business|fitness|ngsl|toeic)-full-[0-9a-f]{12}.bin`.
The word-shard expression is exactly `words-00.json` through `words-1f.json`,
plus its manifest; arbitrary files under `data/generated/vocabulary/` are not
allowed. Reject `.env`, application source, workflow files, absolute paths,
backslashes, `.`/`..` path segments, malformed status/path entries, rename
entries, and deleted schema/source-registry files.

- [ ] **Step 2: Run test and confirm RED**

Run: `npx vitest run scripts/verify-enrichment-diff.test.ts`

Expected: FAIL because the verifier does not exist.

- [ ] **Step 3: Implement the deterministic path gate**

Export a pure verifier and a CLI that consumes newline-delimited `git diff
--name-status --no-renames` entries (`A`, `M`, or `D`, one tab-delimited path).
Reject malformed entries and unsafe repository paths before applying the exact
allow-list. Return a non-zero exit for any disallowed path or deletion of
`schema.json`, `sources.json`, or the canonical `manifest.json`.

- [ ] **Step 4: Add the manual workflow**

Use `actions/checkout@v4`, `actions/setup-node@v4`, `npm ci`, then:

```yaml
permissions:
  contents: write
  pull-requests: write

on:
  workflow_dispatch:
    inputs:
      list:
        type: choice
        options: [ngsl, academic, business, toeic, fitness]
        default: ngsl
      limit:
        type: number
        default: 20
      dry_run:
        type: boolean
        default: true
```

The workflow runs enrichment, `lint:vocabulary`, audit, tests, typecheck, lint,
`build:graphs`, and production build. If `dry_run` is false and the diff is allowed,
it stages only the validated changed-path list, creates
`automation/vocabulary-${GITHUB_RUN_ID}`, commits, pushes that branch, and uses
`gh pr create` with labels `content` and `automated-enrichment`. If no diff exists,
it exits successfully without a branch.

- [ ] **Step 5: Verify workflow syntax and secret hygiene**

Run: `npx vitest run scripts/verify-enrichment-diff.test.ts`

Run: `rg -n 'LLM_API_KEY|MOONSHOT_API_KEY' .github/workflows/vocabulary-enrichment.yml`

Expected: the workflow references `${{ secrets.LLM_API_KEY }}` only; it never echoes the value or passes it in a command argument.

- [ ] **Step 6: Commit**

```bash
git add .github/workflows/vocabulary-enrichment.yml scripts/verify-enrichment-diff.ts scripts/verify-enrichment-diff.test.ts README.md
git commit -m "ci: add reviewed vocabulary enrichment workflow"
```

---

### Task 9: Cut Over and Remove Active Markdown Vocabulary Pages

**Files:**
- Delete: `wiki/pages/*.md`
- Delete: `scripts/wiki-edit.ts`
- Delete: `scripts/enrich-wiki-llm.ts`
- Delete: `scripts/seed-wiki-pages.ts`
- Delete: `scripts/lint-wiki.ts`
- Delete: `lib/wiki/parse-wiki.ts`
- Delete: `lib/wiki/parse-wiki.test.ts`
- Modify: `README.md`
- Modify: `wiki/CLAUDE.md`
- Modify: `package.json`

**Interfaces:**
- Retains Markdown parsing only as `parseLegacyMarkdownPage` in
  `lib/vocabulary/legacy-markdown.ts` for recovery migration.
- Makes `content/vocabulary/*.ndjson` the documented source of truth.

- [ ] **Step 1: Prove no production imports remain**

Run:

```bash
rg -n 'lib/wiki/parse-wiki|readAllPages|readPage|wiki/pages|wiki-edit|enrich-wiki-llm|seed-wiki-pages|lint-wiki' app components lib scripts --glob '!scripts/migrate-wiki-to-ndjson.ts' --glob '!lib/vocabulary/migrate-markdown.ts' --glob '!lib/vocabulary/legacy-markdown.ts'
```

Expected: no production/runtime consumer; only explicitly retained migration code may match.

- [ ] **Step 2: Run the complete pre-deletion gate**

Run: `npm run validate:vocabulary-migration`

Run: `npm test`

Run: `npx tsc --noEmit`

Run: `npm run lint`

Run: `npm run lint:vocabulary`

Run: `npm run audit:dictionary`

Run: `npm run build:graphs`

Run: `npm run build`

Expected: all commands exit 0 and graph/artifact counts match the committed migration report.

- [ ] **Step 3: Create a local recovery tag**

Run: `git tag pre-ndjson-vocabulary`

Expected: local tag points to the last commit containing active Markdown. Do not push the tag without user authorization.

- [ ] **Step 4: Remove Markdown and obsolete mutators**

Run: `git rm -r wiki/pages`

Delete obsolete Markdown mutation/lint scripts and `lib/wiki/parse-wiki.ts` plus its
test only after the import search from Step 1 is clean. Keep
`lib/vocabulary/legacy-markdown.ts`, migration code, and the local tag for recovery.

- [ ] **Step 5: Rewrite source-of-truth documentation and scripts**

Document the NDJSON record schema, shard rule, source registry, enrichment PR workflow,
generated artifacts, local dry run, and recovery tag. Remove package scripts that seed
or enrich Markdown. Keep `migrate:vocabulary` explicitly labelled as recovery-only.

- [ ] **Step 6: Run the final post-deletion gate**

Run: `npm test`

Run: `npx tsc --noEmit`

Run: `npm run lint`

Run: `npm run lint:vocabulary`

Run: `npm run audit:dictionary`

Run: `npm run build:graphs`

Run: `npm run build`

Run: `git diff --check`

Expected: all exit 0, Vercel build output contains no broad `wiki/pages` file-pattern warning, and `find wiki/pages -type f` fails because the directory is absent.

- [ ] **Step 7: Commit the cutover**

```bash
git add -A wiki/pages scripts/wiki-edit.ts scripts/enrich-wiki-llm.ts scripts/seed-wiki-pages.ts scripts/lint-wiki.ts lib/wiki/parse-wiki.ts lib/wiki/parse-wiki.test.ts README.md wiki/CLAUDE.md package.json
git commit -m "refactor: complete ndjson vocabulary cutover"
```
