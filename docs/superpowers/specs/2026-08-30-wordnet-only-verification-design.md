# DictionaryAPI-Outage Vocabulary Verification

Date: 2026-08-30

## Purpose

Allow advanced-vocabulary verification to continue while DictionaryAPI.dev is
unhealthy. The verifier offers a network-assisted profile that skips only
DictionaryAPI, plus a deterministic WordNet-only fallback. Neither profile weakens
the existing full live verifier or treats an unavailable provider as successful
evidence.

## Command

Recommended outage command:

`npm run verify:advanced -- --skip-dictionaryapi ...`

Deterministic fallback:

`npm run verify:advanced -- --wordnet-only ...`

Both options are valid only for live runs, cannot be combined with each other, and
cannot be combined with `--fixture`. The selected mode is part of the pinned batch
identity and uses a namespaced cache directory, so profiles cannot replay each
other's batches or reuse active manifests accidentally.

## Recommended Outage Policy

`--skip-dictionaryapi`:

- Query the installed offline WordNet adapter for definitions and lexical relations.
- Do not call DictionaryAPI.dev.
- Query Tatoeba for sourced English examples.
- Use DeepSeek only to choose among supplied factual senses or validate supplied
  reciprocal relationships; it cannot author dictionary facts.
- Request DeepSeek non-thinking JSON mode because these are finite ID-selection
  decisions, not open-ended reasoning tasks.
- Stop model relationship checks after the first supported reciprocal anchor. Emit
  conservative `relationship_ambiguous` decisions for the remaining existing anchors
  so they stay `unreviewed` without additional model cost.
- Treat a Tatoeba or DeepSeek failure as an infrastructure failure that prevents the
  dry-run from authorizing a write.

## Deterministic Fallback Policy

- Query the installed offline WordNet adapter.
- Do not call DictionaryAPI.dev.
- Do not call Tatoeba.
- Do not call the LLM sense or relationship judges.
- Publish only candidates resolved by the existing deterministic gates: exact lemma,
  exact part of speech, factual definition, WordNet-sourced example, and direct
  lexical support for at least one reciprocal core-word relationship.
- Keep candidates that need disambiguation or model judgment hidden.
- Preserve the current `provider_failed` behavior when WordNet itself fails.

In `--wordnet-only`, `judge_unavailable` is an expected candidate outcome in the declared deterministic
mode, not a live-infrastructure failure. It may coexist with successful candidates in
a pinned dry-run. Provider and budget failures still prevent pinning and therefore
prevent writes.

## Safety and Testing

- Full mode remains byte-for-byte behaviorally unchanged.
- Dry-run remains mandatory before `--write`.
- The active batch identity includes the provider mode.
- Tests prove disabled adapters are never called, deterministic WordNet evidence can
  publish, failures remain hidden, and a mode mismatch cannot replay a batch.
- Initial production use is a bounded dry-run only; no canonical NDJSON is written
  without a separate explicit `--write` command.
