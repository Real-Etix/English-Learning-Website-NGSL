# Vocabulary Corpus — Operating Rules

`content/vocabulary/*.ndjson` is the canonical, editable vocabulary source. Do not add
or restore `wiki/pages`; Markdown parsing is recovery-only. This `wiki/` directory now
holds retained raw clippings and these operating rules.

## Corpus layout and deterministic writes

- `content/vocabulary/00.ndjson` through `content/vocabulary/1f.ndjson` contain one
  v1 JSON record per line. Normalize a lemma by trimming, lowercasing, and collapsing
  whitespace; place it in `sha256(normalizedLemma)[0] & 31`, formatted as two lowercase
  hexadecimal digits. Sort records by normalized lemma in every shard.
- `content/vocabulary/schema.json` is the generated public schema; runtime validation
  is `lib/vocabulary/schema.ts`. A record includes identity/tier, forms and list
  memberships, status/publication status, source references, senses/examples,
  pronunciation, usage notes, typed connections, domains, chart, and region.
- `content/vocabulary/sources.json` is the authoritative source registry. Use a
  registered `sourceId`; preserve source URLs, external IDs, retrieval times, and hashes
  when they are known. `llm` is drafting provenance, not factual evidence.
- `content/vocabulary/manifest.json` records deterministic shard metadata and historical
  migration provenance. Do not hand-edit it; regenerate it only through approved
  recovery tooling.

## Content and relationship rules

Keep authored definitions, examples, usage notes, and connection glosses verbatim.
Factual sources are `curated`, `wordnet`, `dictionaryapi`, and `tatoeba`; distinguish
them from an `llm` drafting pass. A learner may claim a word only when the normalized
profile has a trustworthy primary meaning and a sourced example.

Allowed connection types are `synonym`, `antonym`, `intensity`, `builds_on`,
`advanced_form`, `morphological`, and `collocation`. Every advanced record needs a
`builds_on` connection to a core anchor, and `builds_on` / `advanced_form` are reciprocal.
`npm run lint:vocabulary` validates schema, shard placement, links, sources, duplicates,
and reciprocity; `npm run audit:dictionary` reports quality debt without editing files.

## Generated artifacts and local workflow

Do not hand-edit `data/generated/graphs/`, `data/generated/vocabulary/`, or
`public/generated/galaxy/`. After an intentional NDJSON change, run:

```bash
npm run lint:vocabulary
npm run audit:dictionary
npm test
npx tsc --noEmit
npm run lint
npm run build:graphs
npm run build
```

For a no-write local enrichment preview:

```bash
npm run enrich:vocabulary -- --list=ngsl --limit=20 --dry-run
```

## Reviewed enrichment PR workflow

Run the **Vocabulary enrichment** GitHub Actions workflow manually. Keep `dry_run`
enabled to validate first. With it disabled, the workflow uses the `LLM_API_KEY`
repository secret (and optional `LLM_BASE_URL` / `LLM_MODEL` variables), validates the
canonical corpus and generated artifacts, permits only approved vocabulary/artifact
paths, and opens one `automation/vocabulary-<run-id>` pull request when there is a diff.
It never pushes directly to the default branch. Review that PR before merging; never
place the key in a command argument, log, committed file, or generated artifact.

## Recovery-only Markdown migration

`wiki/raw/` remains the immutable clipping inbox; store only license-permitted excerpts
and provenance. Legacy Markdown conversion survives only in
`lib/vocabulary/legacy-markdown.ts`, `lib/vocabulary/migrate-markdown.ts`, and
`scripts/migrate-wiki-to-ndjson.ts`. `npm run migrate:vocabulary` is recovery-only and
must target a copied legacy source and a separate output directory.

The local `pre-ndjson-vocabulary` tag marks the last committed active Markdown corpus.
Do not push it. If recovery is necessary, inspect that tag and regenerate NDJSON for
review; do not make Markdown active again.
