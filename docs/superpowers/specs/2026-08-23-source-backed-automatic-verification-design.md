# Source-Backed Automatic Advanced Vocabulary Verification

Date: 2026-08-23

## Purpose

Build a conservative, resumable pipeline that verifies the 6,133 hidden advanced
vocabulary records with factual sources and automatically publishes only records that
pass all evidence, sense, example, and relationship gates. No human content approval
is required, but a failed or ambiguous candidate remains hidden.

## Current Corpus

The canonical source of truth is the 32 NDJSON shards under `content/vocabulary/`.
A local audit on 2026-08-23 found:

- 12,115 canonical records;
- 5,982 published records and 6,133 hidden records;
- all 6,133 hidden records are advanced, LLM-only drafts;
- 9,214 published core-to-advanced connections point to those hidden records;
- zero targets are missing;
- zero hidden targets currently have a factual sense, factual example, or publishable
  sense.

The 9,214 count is therefore connection debt, while the actual verification workload
is 6,133 unique advanced records.

## Goals

- Prioritize hidden words with the greatest learner/network value.
- Import factual definitions, examples, pronunciation, and provenance without letting
  an LLM assert facts or source metadata.
- Select an exact, source-backed sense that matches the record's intended part of
  speech.
- Validate at least one reciprocal relationship to an existing published core word.
- Publish high-confidence records automatically and keep all uncertain records hidden.
- Preserve exact authored connection glosses when a relationship passes.
- Downgrade rejected learner-facing connections to `unreviewed` without deleting them.
- Make batches idempotent, restartable, bounded by request/token budgets, and safe to
  run locally.
- Produce deterministic, sanitized reports and regenerate public artifacts only after
  a successful write.

## Non-Goals

- Publishing every advanced word regardless of evidence coverage.
- Treating DeepSeek output as a factual source.
- Creating new vocabulary records or new connection targets.
- Building an admin review interface or requiring manual per-word approval.
- Running enrichment inside a Vercel request or function.
- Committing raw provider responses, API keys, prompts, or full model responses.
- Replacing canonical NDJSON with PostgreSQL or Markdown.

## Source Hierarchy

The existing source registry remains authoritative:

1. `curated` project-authored content;
2. factual lexical sources: `wordnet` and `dictionaryapi`;
3. factual example source: `tatoeba`;
4. `llm`, which is guidance and decision provenance only.

WordNet is queried offline. DictionaryAPI.dev and Tatoeba are called over the network
in bounded batches. DeepSeek is called through the existing OpenAI-compatible LLM
client and receives only normalized factual evidence plus existing candidate links.

## Architecture

The pipeline consists of six focused units.

### Candidate selector

The selector reads all canonical records and calculates incoming published
core-to-hidden connection counts. Candidates must be advanced and hidden. Ordering is:

1. incoming published connection count, descending;
2. number of distinct published core anchors, descending;
3. normalized lemma, ascending.

Each lemma appears once. A CLI `--limit` bounds the selected batch and defaults to 25.
Already published records are never selected.

### Evidence providers

The provider layer returns normalized evidence rather than provider-specific payloads.
It contains:

- an exact-POS WordNet adapter built on the installed `wordpos` package;
- a DictionaryAPI.dev adapter that retains entry URLs, returned lemma, POS,
  definitions, examples, synonyms, IPA, and audio provenance;
- a Tatoeba adapter that retains sentence ID, sentence URL, text, language, and
  retrieval metadata.

Dictionary results are accepted only when the returned lemma normalizes to the
candidate lemma. A sense is eligible only when its POS maps exactly to the canonical
record POS. Tatoeba sentences must be English and contain the lemma or a canonical
form as a complete token.

### Evidence cache

Normalized provider results and model decisions are cached outside Git under
`.cache/vocabulary-verification/`. Cache keys include provider, normalized lemma,
provider/request version, and a SHA-256 hash of the normalized request. LLM decision
keys additionally include model, prompt version, candidate evidence hash, and anchor
evidence hash.

The cache prevents duplicate network/model cost and makes interrupted batches
resumable. Invalid or truncated cache entries are ignored and refetched. No API key is
written to a cache entry or report.

### Sense verifier

The sense verifier applies deterministic gates before asking DeepSeek anything:

- candidate lemma matches the provider lemma;
- candidate POS exactly matches the factual sense POS;
- definition is non-empty and is not placeholder content;
- definition has a registered factual source reference;
- at least one candidate example has a registered factual source reference;
- the example contains a canonical form as a complete token.

Dictionary or WordNet examples are preferred. A Tatoeba sentence may fill the example
requirement only after DeepSeek selects the same factual sense for that sentence.
DeepSeek receives the finite list of eligible factual senses and may return only one
of their IDs or `ambiguous`. It cannot return a definition, example, source ID,
publication status, or new sense.

If more than one sense remains equally plausible, the candidate is ambiguous and stays
hidden.

### Relationship verifier

Only existing reciprocal `builds_on` / `advanced_form` pairs between the hidden
candidate and published core records are considered. A pair must exist in both
directions and both existing glosses must be non-empty.

Direct lexical support is accepted when normalized WordNet or DictionaryAPI synonym
data corroborates the candidate/core relation. Otherwise DeepSeek performs a grounded
relationship decision using only:

- the selected factual candidate sense;
- published factual senses for the core word;
- the two existing relationship types and exact glosses.

The response schema permits `supported`, `unsupported`, or `ambiguous`, plus the exact
candidate sense ID and core lemma from the request. It cannot rewrite a gloss or add a
target. A non-direct relation is supported only when two order-reversed evaluations
agree on `supported`; disagreement or malformed output is `ambiguous`.

At least one reciprocal pair must be supported before a candidate can be published.
Exact existing gloss bytes are preserved for supported pairs.

### Mutation engine

The engine is pure: it receives a canonical snapshot plus normalized evidence and
decisions, and returns proposed record updates and reason codes.

For a passing candidate:

- append source-backed evidence and pronunciation idempotently;
- set the selected factual sense to `published`;
- set legacy LLM-only senses to `hidden`;
- leave other imported factual senses as `review`;
- set `status` to `enriched` and `publicationStatus` to `published`;
- retain supported reciprocal links as `published`;
- set rejected or ambiguous reciprocal links to `unreviewed` on both records;
- preserve supported connection gloss text exactly.

For a non-passing candidate:

- retain successfully imported factual evidence;
- keep `publicationStatus` as `hidden`;
- keep eligible unselected factual senses at `review`;
- downgrade rejected or ambiguous reciprocal learner links to `unreviewed` on both
  records, because neither outcome is strong enough for a learner-facing edge.

All affected candidate and core records are written through
`writeVocabularyRecords()`. The complete batch is calculated before any canonical
write. Schema or integrity failure aborts the batch without writing partial record
updates.

## Command-Line Contract

The local entry point is exposed as `npm run verify:advanced` and defaults to dry-run.

```bash
npm run verify:advanced -- --limit=25 \
  --max-source-requests=100 \
  --max-input-tokens=20000 \
  --max-output-tokens=8000 \
  --report=.cache/vocabulary-verification/latest-report.json
```

`--write` enables canonical writes. `--fixture=<path>` replaces every external source
and LLM call for deterministic tests. `--concurrency` defaults to 3 and cannot exceed
5. Request retries default to two with bounded exponential backoff. A source-request
or token budget exhaustion stops selection cleanly after the current record and
reports the unprocessed remainder.

The command never invokes graph generation implicitly during dry-run. After a
successful `--write`, it runs the existing graph builders only when at least one
canonical shard changed. A graph-build failure leaves the canonical updates visible
in Git but returns a non-zero exit so stale generated artifacts cannot be pushed
unnoticed.

## Report Contract

The JSON report is aggregate and safe to upload as a CI artifact. It contains:

- selected, attempted, source-backed, published, ambiguous, unsupported, and failed
  candidate counts;
- accepted, rejected, ambiguous, and downgraded reciprocal relationship counts;
- cache hits/misses by provider;
- request counts and LLM token usage;
- changed shard IDs;
- bounded lemma/reason entries without prompts or provider/model responses;
- remaining hidden advanced and strict-violation counts after the proposed snapshot.

Reason codes are stable enums such as `no_factual_sense`, `pos_mismatch`,
`no_sourced_example`, `sense_ambiguous`, `no_reciprocal_anchor`,
`relationship_unsupported`, `relationship_ambiguous`, `provider_failed`, and
`budget_exhausted`.

## Failure Handling

- Provider timeout, 404, malformed JSON, or exhausted retry budget leaves the candidate
  hidden and records a provider failure.
- A malformed or out-of-schema DeepSeek response is ambiguous, never supported.
- Missing source metadata prevents evidence from satisfying publication gates.
- A missing reciprocal edge prevents that relationship from satisfying the anchor
  requirement.
- Duplicate imports and repeated runs produce byte-identical canonical records.
- Signals are checked before every external call so interruption does not corrupt a
  batch.
- API keys remain in environment variables and never appear in URLs, reports, cache
  metadata, or committed files.

## Testing Strategy

All automated tests use local fixtures and injected provider/LLM functions.

Unit tests cover:

- candidate ranking and deduplication;
- exact lemma/POS evidence filtering;
- factual-source and sourced-example requirements;
- Tatoeba token and sense matching;
- direct lexical relationship support;
- agreeing and disagreeing grounded relationship evaluations;
- reciprocal connection mutation and exact gloss preservation;
- sense/publication status transitions;
- rejection reason codes;
- cache key stability, cache corruption, and resume behavior;
- request/token budget exhaustion;
- idempotent NDJSON updates and no-write dry-run behavior.

Integration tests run a complete fixture batch through selection, verification,
mutation, report generation, and artifact-build decision. Existing publication,
claim-readiness, public-connection, audit, lint, graph, and build tests remain part of
the release gate.

## Release Criteria

- Fixture-backed verification tests pass without network access.
- Full Vitest and TypeScript checks pass.
- Application production build succeeds.
- Re-running the same fixture or cached batch produces no canonical diff.
- Every newly published advanced record passes `isSensePublishable()` and
  `publicationStatusFor()` against the proposed full snapshot.
- Every newly published advanced record has at least one supported reciprocal public
  core anchor.
- Strict violation identities and vocabulary lint findings do not increase.
- No raw provider response, prompt, model response, or API credential is committed.

## Rollout

Start with a fixture batch, then a live dry-run of the 25 highest-incoming candidates.
After verifying report integrity and idempotence, run the same cached batch with
`--write`, regenerate artifacts, and execute all release gates. Continue in bounded
batches ordered by incoming learner-facing value until the source providers are
exhausted. Words that never meet the gates remain hidden rather than being weakened or
fabricated into publication.
