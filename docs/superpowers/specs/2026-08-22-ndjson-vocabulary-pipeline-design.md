# Canonical NDJSON Vocabulary Pipeline Design

## Context

The current vocabulary source is approximately 12,115 Markdown files under
`wiki/pages/`. Each file is parsed into a `WikiPage`, and the resulting pages are
used to build list graphs, chart shards, search catalogs, full-galaxy downloads,
word details, audits, and enrichment output. This preserves the original Wiki-LLM
file workflow, but it creates excessive filesystem work, a large active file tree,
and Markdown-specific editing logic that is no longer valuable for a public
vocabulary product.

The replacement keeps the useful Wiki-LLM properties—versioned long-term memory,
typed relationships, clipping, source attribution, validation, and LLM-assisted
maintenance—without retaining one Markdown file per lemma.

## Decision

Git remains the canonical vocabulary store, but the canonical format changes from
per-word Markdown to 32 deterministic NDJSON shards. PostgreSQL remains responsible
for users, collections, XP, spaces, and social data; vocabulary content is not
duplicated into PostgreSQL.

Production enrichment runs on GitHub Actions rather than a developer laptop. An
enrichment run edits a branch, validates the affected source shards, regenerates
derived graph assets, and opens a pull request. Merging that pull request triggers
the existing Vercel deployment.

## Goals

- Replace the active `wiki/pages/*.md` tree with 32 canonical NDJSON shards.
- Preserve every lemma, display form, list membership, rank, SFI value, definition,
  example, form, source, status, chart, region, domain, connection type, target, and
  authored gloss exactly through migration.
- Keep a stable storage-neutral vocabulary model shared by import, validation,
  enrichment, graph generation, audits, tutor grounding, and word detail delivery.
- Make source and generated output deterministic so repeated builds produce no diff.
- Run production enrichment without requiring a local computer.
- Keep all generated galaxy assets compatible with the current progressive loader.
- Remove Markdown pages and Markdown runtime parsing only after parity checks pass.

## Non-goals

- Do not move vocabulary content into PostgreSQL.
- Do not allow end users to edit vocabulary content.
- Do not let an LLM push directly to the default branch or publish without validation.
- Do not rewrite Git history to erase old Markdown blobs.
- Do not redesign the galaxy renderer or user/social database in this migration.
- Do not create a second editable NDJSON export or bidirectional synchronization.

## Canonical File Layout

```text
content/vocabulary/
├── 00.ndjson
├── 01.ndjson
├── ...
├── 1f.ndjson
├── schema.json
├── sources.json
└── manifest.json
```

The shard ID is the low five bits of a stable SHA-256 digest of the normalized
lemma, rendered as lowercase hexadecimal from `00` through `1f`. A record therefore
never moves because another record is inserted. Records inside each shard are sorted
by Unicode code point order of normalized lemma and end with exactly one newline.

`manifest.json` records:

- schema version;
- total words and connections;
- per-shard record count, byte count, and SHA-256 checksum;
- per-list word counts;
- evidence/publication counts.

## Vocabulary Record

Each NDJSON line is one self-contained `VocabularyRecord`:

```ts
type VocabularyRecord = {
  schemaVersion: 1;
  lemma: string;
  display: string;
  tier: "core" | "advanced";
  partOfSpeech: string;
  forms: string[];
  lists: Array<{ id: string; rank: number | null; sfi: number | null }>;
  status: "seeded" | "enriched" | "verified";
  publicationStatus: "draft" | "review" | "published" | "hidden";
  sources: ContentSourceRef[];
  senses: VocabularySense[];
  pronunciation: PronunciationRecord[];
  usageNote: string | null;
  connections: VocabularyConnection[];
  domains: string[];
  chart: string | null;
  region: string | null;
};
```

The first migration creates one sense from the current `## Definition` and
`## Examples` data. Missing future-only fields use empty arrays; they are never
fabricated during conversion. To preserve graph parity, records begin with the same
public visibility they have before migration; Vocabulary v2 subsequently applies the
advanced-draft quarantine before enrichment resumes.

The referenced child records use these stable shapes:

```ts
type ContentSourceRef = {
  sourceId: string;
  externalId: string | null;
  url: string | null;
  retrievedAt: string | null;
  contentHash: string | null;
};

type SenseExample = {
  text: string;
  sources: ContentSourceRef[];
};

type UsagePattern = {
  pattern: string;
  explanation: string;
  examples: SenseExample[];
  sources: ContentSourceRef[];
  status: "draft" | "review" | "published";
};

type CollocationPhrase = {
  phrase: string;
  explanation: string | null;
  sources: ContentSourceRef[];
  status: "draft" | "review" | "published";
};

type CommonMistake = {
  incorrect: string;
  correction: string;
  explanation: string;
  sources: ContentSourceRef[];
  status: "draft" | "review" | "published";
};

type VocabularySense = {
  id: string;
  partOfSpeech: string;
  definition: string;
  labels: string[];
  sources: ContentSourceRef[];
  examples: SenseExample[];
  usagePatterns: UsagePattern[];
  collocations: CollocationPhrase[];
  commonMistakes: CommonMistake[];
  status: "draft" | "review" | "published";
};

type PronunciationRecord = {
  ipa: string | null;
  region: "uk" | "us" | "other";
  audioUrl: string | null;
  sources: ContentSourceRef[];
};
```

`sources.json` is the canonical registry for source IDs and stores provider name,
license note, homepage, and whether that provider may back factual content. A source
reference may add a provider-specific record ID or URL without duplicating registry
metadata.

Every source-dependent child object carries its own source reference. Page-level
legacy sources remain attached during migration and are narrowed to sense/example
sources only by later reviewed enrichment.

Connections use explicit fields instead of `[[wiki-link]]` syntax:

```ts
type VocabularyConnection = {
  target: string;
  type: "synonym" | "antonym" | "intensity" | "builds_on" |
    "advanced_form" | "morphological" | "collocation";
  gloss: string | null;
  sources: ContentSourceRef[];
  status: "unreviewed" | "published" | "hidden";
};
```

## Storage Boundary

All consumers use a repository interface rather than reading files directly:

```ts
interface VocabularyRepository {
  get(lemma: string): Promise<VocabularyRecord | null>;
  all(): AsyncIterable<VocabularyRecord>;
  list(listId: string): AsyncIterable<VocabularyRecord>;
}
```

The production implementation reads NDJSON shards. Tests can use an in-memory
implementation. Enrichment uses a separate writer that acquires a repository lock,
rewrites only affected shards through temporary files, sorts records, validates the
complete result, and atomically replaces the shard files.

## One-time Migration

1. Freeze all scripts that mutate `wiki/pages`.
2. Record a migration baseline with total and per-list page/edge counts plus a
   canonical content hash for every lemma.
3. Parse the existing Markdown with the current parser.
4. Convert each page into `VocabularyRecord` without paraphrasing authored text.
5. Write deterministic NDJSON shards and the manifest.
6. Read the NDJSON back through the new repository and compare every field with the
   parsed Markdown model.
7. Build both Markdown-backed and NDJSON-backed list graphs and require structural
   equality for nodes, edges, charts, names, list membership, ranks, and SFI.
8. Run dictionary audits through both sources and require equal results.
9. Switch graph, API, tutor, composition, collection seeding, chart naming, and audit
   consumers to the repository interface.
10. Regenerate all graph and galaxy artifacts from NDJSON.
11. Run the complete test, lint, typecheck, graph, and production-build suite.
12. Tag the last Markdown-backed commit and remove `wiki/pages/*.md` in a separate
    commit. Keep schema documentation, clipping inputs, and migration tools.

The current observed baseline is 12,115 pages and 78,103 typed connections. The
migration command must calculate and lock its own baseline at execution time and
stop if the working source differs from the expected snapshot.

## Generated Runtime Artifacts

Canonical NDJSON is build input, not a browser payload. The existing build pipeline
continues to generate:

- per-list intermediate graphs under `data/generated/graphs/`;
- list manifests under `public/generated/galaxy/manifests/`;
- chart shards, search catalogs, and full-galaxy files under
  `public/generated/galaxy/assets/`.

The word-detail pipeline additionally generates hashed vocabulary-detail shards so
the browser never downloads all vocabulary records to open one star. These artifacts
contain only published learner-facing fields and exclude hidden proposals.

Generated artifacts remain committed during the initial migration. This preserves
the current Vercel deployment model and keeps graph generation out of request paths.

## Cloud Enrichment Workflow

Production enrichment runs in GitHub Actions with `workflow_dispatch` and optional
scheduled triggers. The workflow:

1. checks out a new enrichment branch;
2. selects records using explicit list, SFI, evidence, and batch-limit arguments;
3. calls dictionary sources and the configured LLM with repository secrets;
4. writes proposals through the validated shard writer;
5. runs focused content validation and the dictionary audit;
6. regenerates graph artifacts when nodes, charts, or connections change;
7. runs tests, typecheck, lint, and the production build;
8. creates or updates one pull request containing the source and derived changes.

No workflow may commit directly to the default branch. API keys never appear in
generated files, logs, URLs, pull-request text, or browser requests. Failed batches
leave the canonical branch unchanged.

The local CLI remains available for dry runs and debugging, but production does not
depend on a developer machine.

## Validation and Publication Rules

- Reject malformed records, duplicate lemmas, duplicate list IDs, invalid source
  references, dangling connection targets, invalid edge types, and non-reciprocal
  `builds_on`/`advanced_form` edges.
- Reject non-finite ranks and SFI values.
- Preserve authored definitions, examples, and glosses byte-for-byte except for
  structural newline normalization.
- Do not publish LLM text as factual evidence merely because validation succeeded.
- Do not include hidden words or hidden/unreviewed connections in learner-facing
  detail or tutor artifacts.
- Require deterministic output and fail when a no-change run creates a diff.

## Failure and Recovery

- Each enrichment run works on a branch; the default branch is the rollback point.
- A failed shard write cannot replace a valid shard.
- A generated-artifact failure prevents pull-request publication.
- The pre-migration Git tag restores the Markdown implementation if parity fails.
- The previous Vercel deployment remains available if a merged release regresses.
- Git history retains the removed Markdown pages without placing them in the active
  working tree or Vercel bundle.

## Acceptance Criteria

- Exactly 32 canonical NDJSON shards replace the active Markdown page directory.
- The migration report proves field-level parity for every migrated lemma.
- Node, edge, list, chart, search, and full-galaxy counts match the migration baseline.
- The word API and tutor no longer import the Markdown parser.
- No production route scans vocabulary source files.
- A GitHub Actions dry-run makes no commit and exposes no secret.
- A fixture enrichment run changes one expected record, regenerates required assets,
  passes validation, and opens a reviewable branch/PR payload.
- Full tests, TypeScript, ESLint, dictionary audit, graph build, and Next.js production
  build pass before Markdown removal.
