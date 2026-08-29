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
  when they are known. Source precedence is `curated` wording, then factual imports
  (`wordnet`, `dictionaryapi`, `tatoeba`), then an `llm` drafting pass. `llm` is
  drafting provenance, not factual evidence.
- `content/vocabulary/manifest.json` records deterministic shard metadata and historical
  migration provenance. Do not hand-edit it; regenerate it only through approved
  recovery tooling.

## Publication, claims, and relationship rules

Use publication states deliberately: `draft` is incomplete work, `review` awaits an
editorial decision, `published` is learner-visible, and `hidden` is retained
quarantine/editorial material. Only published records flow into public word, graph,
and star-count artifacts. Hidden drafts remain visible to deterministic audits and
advanced-draft enrichment, but never inflate public star counts.

Keep authored definitions, examples, usage notes, and connection glosses verbatim.
Factual sources are `curated`, `wordnet`, `dictionaryapi`, and `tatoeba`; distinguish
them from an `llm` drafting pass. A learner claims exactly one selected canonical
sense, not an arbitrary word-level substitute. The record and selected sense must be
published, with a complete factual/verified meaning and a sourced example for that
same sense. A published connection is public guidance only if it targets a published
record and has a non-empty authored gloss. Hidden and unreviewed connections may be
kept as editorial debt but must not appear as public guidance.

Allowed connection types are `synonym`, `antonym`, `intensity`, `builds_on`,
`advanced_form`, `morphological`, and `collocation`. Every advanced record needs a
`builds_on` connection to a core anchor, and `builds_on` / `advanced_form` are reciprocal.
`npm run lint:vocabulary` validates schema, shard placement, links, sources, duplicates,
and reciprocity; `npm run audit:dictionary` reports quality debt without editing files.
It prints stable global and per-list totals for publication, senses, usage,
connections, advanced quarantine, claimable senses, source coverage, and strict
categories plus a deterministic, sorted `strictViolations` identity list.
`npm run audit:dictionary -- --strict` is the release gate: it blocks only published
placeholders, unsupported published senses, otherwise-claimable senses with no sourced
example, published connections to hidden/missing targets, and published connections
without glosses. Missing optional patterns/mistakes and hidden/unreviewed debt remain
non-blocking. Audit is deterministic and never calls live providers.

## Generated artifacts and local workflow

Do not hand-edit `data/generated/graphs/`, `data/generated/vocabulary/`, or
`public/generated/galaxy/`. After an intentional NDJSON change, run:

```bash
npm run lint:vocabulary
npm run audit:dictionary
npm run audit:dictionary -- --strict
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

Select enrichment in the deterministic core-first NGSL, Academic, Business, TOEIC,
Fitness order; supported hidden advanced drafts follow. Keep each batch inside the
configured record limit plus input/output token budgets. Do not treat a larger token
budget as permission to bypass review or invent facts.

## Local source-backed advanced verification

Run this verifier locally only; it does not run in Vercel. The first successful
invocation atomically saves an active batch inside the selected cache root. Dry
runs and writes thereafter replay that exact batch, so a write cannot advance to
the next hidden words. To begin a later batch, delete only
`.cache/vocabulary-verification/active-batch.json`; retain the provider/model cache.
Offline fixture state uses the isolated `fixture/` subdirectory, so it cannot pin
synthetic fixture words for a later live run.
`--write` is rejected until a successful dry-run has created the live active-batch
manifest. That manifest pins the limits, concurrency, model/endpoint identity,
fixture digest (when used), and expected post-verification record hashes. A changed
configuration, changed fixture, or recomputed outcome fails closed before persistence.

```bash
# Offline, zero-cost integration check
npm run verify:advanced -- \
  --fixture=scripts/fixtures/vocabulary-verification/source-backed-batch.json \
  --report=.cache/vocabulary-verification/fixture-report.json

# Live dry-run; canonical NDJSON remains untouched
npm run verify:advanced -- \
  --limit=25 \
  --concurrency=3 \
  --max-source-requests=100 \
  --max-input-tokens=20000 \
  --max-output-tokens=8000 \
  --report=.cache/vocabulary-verification/latest-report.json

# Apply the exact cached batch and rebuild generated artifacts
npm run verify:advanced -- \
  --limit=25 \
  --concurrency=3 \
  --max-source-requests=100 \
  --max-input-tokens=20000 \
  --max-output-tokens=8000 \
  --report=.cache/vocabulary-verification/latest-write-report.json \
  --write
```

Review canonical NDJSON and regenerated artifacts in Git. The cache, active-batch
manifest, and reports are disposable and must not be committed. Uncertain records
stay hidden.

## Reviewed enrichment PR workflow

Run the **Vocabulary enrichment** GitHub Actions workflow manually. Keep `dry_run`
enabled to validate first. With it disabled, the workflow uses the `LLM_API_KEY`
repository secret (and optional `LLM_BASE_URL` / `LLM_MODEL` variables), validates the
canonical corpus and generated artifacts, permits only approved vocabulary/artifact
paths, and opens one `automation/vocabulary-<run-id>` pull request when there is a diff.
It never pushes directly to the default branch. Review that PR before merging; never
place the key in a command argument, log, committed file, or generated artifact.

Before proposals, the workflow saves JSON strict-audit and vocabulary-lint reports for
the base corpus. After proposals, it rejects a strict category increase or a new strict
violation identity. It also rejects newly introduced vocabulary-lint error identities,
but allows unchanged or reduced inherited findings; malformed or crashed lint output
fails the gate. `npm run lint:vocabulary` itself stays strict for local use. Review the
generated diff, audit categories, source provenance, selected-sense claim evidence,
and graph artifacts before merge. It intentionally does not upload full provider
responses.

## Recovery-only Markdown migration

`wiki/raw/` remains the immutable clipping inbox; store only license-permitted excerpts
and provenance. Legacy Markdown conversion survives only in
`lib/vocabulary/legacy-markdown.ts`, `lib/vocabulary/migrate-markdown.ts`, and
`scripts/migrate-wiki-to-ndjson.ts`. `npm run migrate:vocabulary` is recovery-only and
must target a copied legacy source and a separate output directory.

The local `pre-ndjson-vocabulary` tag marks the last committed active Markdown corpus.
Do not push it. If recovery is necessary, inspect that tag and regenerate NDJSON for
review; do not make Markdown active again.
