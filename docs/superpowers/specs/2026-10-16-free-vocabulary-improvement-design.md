# Free vocabulary improvement pass

## Approved outcome

The user approved the free-only recommendation on 2026-10-16, after separately
approving list-specific specialist exclusions and recoverable archiving. This
pass repairs identities, records topic decisions, evaluates Open English Wordnet
(OEWN), and extracts more evidence already present in Wiktionary. It does not
subscribe to a dictionary, spend LLM credits, erase records, or automatically
publish newly found meanings. Limited examples are acceptable only after the
meaning itself has been reviewed; missing examples are not evidence of a wrong word.

## Identity and scope

The 1,263 advanced records are the pinned recovery-v2 remainder. Preserve all
stable `lemma` IDs, official list memberships, connections, source wording and
user collection references. Repair a headword through `display` and `forms`, with
an attributable editorial receipt. Dictionary lookups use the corrected headword.
Do not silently merge a correction with a different existing record.

Add optional editorial metadata to the existing version-1 schema (old records
remain valid). A reviewed scope holds allowed learning lists and an explanation;
an archived scope is non-public even if a later enrichment mistakenly sets the
record to published. Official core entries cannot receive these overrides.
Unknown relevance is not irrelevance: leave uncertain scope unset and in review.
An allowed list is a restriction on existing graph inclusion, not fabricated
membership in an official frequency list. The All words view includes all public,
non-archived words. Personal collections retain stable identifiers.

## Evidence and evaluation

Use OEWN's documented `GET https://en-word.net/api/lemma/{lemma}` interface.
Require an exact returned member match; do not import a synonym's sense merely
because it occurs in the same response. Preserve synset identity, source URL,
retrieval time, hash, licence and attribution. Keep external attributed quotations
out of imported examples unless their reuse rights are established. An OEWN
candidate is review material, not publication approval.

Read existing Wiktionary cache envelopes without new requests where possible.
Extract explicit topic labels, form information, sense-attached usage/example
data and lexical relations as evidence; never guess a collocation from a synonym
or turn an arbitrary sentence into a definition. Keep imported senses in review
and preserve all previous senses.

All new requests are public/no-key, sequential with >=1 second spacing, bounded
by a request limit, a 25-second timeout and a 2 MiB response limit. Retained
new cache is capped at 250 MiB. Successful lookups (including exact empty results)
are cached; network failures are not cached as absence. No LLM calls or changes
to the existing spending ledger. Start with a small source pilot before extending
requests; offline assessment can cover the whole remainder without new costs.

## Verification and delivery

Tests precede implementation: Unicode/spaces, collision rejection, core protection,
idempotence, scope filtering, archiving, exact-member OEWN parsing, sourced-example
identity, cache limits, and attribution. Validate the original corpus count and
core records, run all tests, TypeScript, lint, regenerate schemas/word/graph assets,
and build. Keep the changes local unless delivery is explicitly requested for
this new pass. Report evidence found separately from words made public.

## Alternatives considered

- Add a paid learner dictionary: potentially better examples, but not approved
  for spending or permanent storage and unnecessary for identity repairs.
- Publish every word with any dictionary match: rejected because a match does not
  establish the appropriate sense or relevance.
- Delete obscure words globally: rejected in favour of recoverable list-specific
  exclusions, preserving official lists and uncertain cases.

## References checked

- https://en-word.net/api/openapi.yaml
- https://en-word.net/downloads
- https://github.com/globalwordnet/english-wordnet/blob/main/LICENSE.md

Implementation will run inline in the existing requested checkout; no subagents,
duplicate workers, extra worktree copies or unattended paid processes.
