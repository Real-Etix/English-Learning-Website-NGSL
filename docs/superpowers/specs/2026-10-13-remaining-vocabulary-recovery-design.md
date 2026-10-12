# Remaining vocabulary recovery

## Outcome and review gate

Assess all 444 unclaimable core records and 1,637 hidden advanced records.
Publish only source-supported senses with a matching, attributable example.
Completion means every candidate has a recorded outcome, release checks pass,
and the approved delivery is verified. It does not mean publishing every record.

The user approved continuing the recovery proposal. This document records the
scope for final review before implementation. Additional paid calls, new-source
imports, and a new production push await approval of the package below.

## Current evidence

| Last-pass reason | Core | Advanced |
| --- | ---: | ---: |
| No matching factual sense | 124 | 647 |
| No suitable sourced example | 92 | 901 |
| Sense/example match ambiguous | 228 | 89 |

The existing runner restricts evidence to one record-level part of speech.
WordNet supports noun, verb, adjective and adverb lookups, leaving grammatical
words uncovered. Inspection found `who` matched to the organisation WHO, `may`
to a month/plant, and `because` and `into` without usable definitions. These are
pipeline coverage/identity limitations, not judgments that the words are invalid.
Some advanced drafts contain a sentence where a definition belongs.

## Recommended approach and alternatives

Use licensed Wiktionary-derived data as a dictionary fallback, keep WordNet and
Tatoeba, and match evidence by sense and grammatical role. This improves coverage
without asking a model to invent definitions or examples.

Repeating the unchanged WordNet-only pass is inexpensive to implement but does
not address grammatical coverage. Generating missing content would be a different
editorial policy and is excluded from this pass. No commercial dictionary account
or subscription is needed for the proposed work.

## Source ingestion and storage

- Register Wiktionary-derived evidence separately from WordNet and LLM output.
- Prefer the small Simple English Wiktionary extraction and targeted English
  entries, using public interfaces and their published access limits.
- Do not download the multi-gigabyte complete English/all-language dictionary.
  Cap new retained source/cache data at 250 MiB, with streamed response limits.
  If safe targeted access cannot supply a word, record a source limitation.
- Keep only relevant imported entries in canonical NDJSON. Raw evidence stays
  git-ignored; never upload a complete dictionary dump to GitHub or Vercel.
- Retain exact source wording, source entry/sense identity, origin URL,
  retrieval time, content hash, authorship/history attribution and licence.
- Treat attribution as part of the deliverable: expose source and licence links
  in word details, and preserve metadata in generated artifacts.
- Apply the stated CC BY-SA requirements to imported Wiktionary text. Exclude
  external literary quotations, audio and other material whose reuse rights
  cannot be established. Tatoeba examples require sentence-specific attribution
  and licence information, not only a generic provider badge.
- Do not fetch Cambridge or other proprietary dictionary text without a licence.

## Sense identity and publication

- Preserve record lemmas, list memberships, stable existing sense IDs, user
  collections and recovery keys. No database migration or destructive merge.
- Evaluate each supplied sense's own part of speech; the record's previous POS
  must not veto valid pronoun, conjunction, preposition or auxiliary senses.
- Source adapters must verify English language, headword, grammatical role and
  sense identity. Case folding alone must not turn `who` into `WHO` or `may` into
  `May`. Capitalization differences need explicit lexical evidence.
- Prefer ordinary learner senses over proper names/abbreviations for core words.
  Retain legitimate alternate meanings separately; do not silently overwrite them.
- Recognize inflected forms only through explicit source form relations. Preserve
  plural/core entries; do not delete IDs or award duplicate collection rewards.
- Native examples attached to a source sense can qualify after identity, whole-
  form and licence checks. External sentences need a confident match to that
  particular sense and POS. Never insert a synonym into a source sentence.
- DeepSeek may select only supplied finite sense/example identifiers. It may
  abstain; malformed output, ambiguity and network failures never publish content.
- Do not relabel model-authored text as curated or source-backed evidence.
- Keep relationship review separate. Recovering a word does not publish its
  synonyms, collocations or advanced-form edges automatically.
- Core entries without a safe sense remain searchable but unclaimable. Advanced
  records without one remain hidden. Keep their source history and explicit reason.

## Execution and accounting

Use one worker, batches of 25 and at most three concurrent requests. No subagents.
Add separate versioned recovery checkpoints under the existing ignored repair
directory. Preserve the completed first-pass checkpoint and delivery receipt.
Use the SAME persisted `spend.json` ledger, never a fresh spending allowance.

Proposed approval: retain the 16 CNY cumulative software cap, including the
1.64935 CNY already conservatively charged. This permits at most 14.35065 CNY
additional accounting, below the user's original 17 CNY total ceiling. Verify
current provider prices and available balance before paid calls; count retries,
timeouts and interrupted reservations. Stop safely on insufficient funds or a
price change the reservation calculation does not cover. No automatic top-ups,
new paid providers or ongoing user-facing API spend is authorized by this pass.

Cache successful source responses and decisions. Version query keys when fixing
POS/case matching so bad legacy lookups are not silently reused. Distinguish an
absent entry from a timeout, malformed response or rate limit. Bounded retry and
backoff, worker locking and atomic checkpoints must survive restart without
duplicating paid calls or corrupting canonical shards.

## Pilot and rollout

The 25-word pilot deliberately covers successful and withheld outcomes:

- Missing core senses: because, into, when, should, what.
- Ambiguous core senses: who, may, might, present, contract.
- Missing core examples: collection, survival, firstly, listener, availability.
- Advanced identity gaps: abdominals, adjudicators, -hydroxypropanoate.
- Advanced example gaps: absolution, acclimate, accumulator, achievable.
- Ambiguous advanced senses: accused, adjunct, ascending.

Inspect every pilot decision against its actual evidence. Tests must reject WHO
for the pronoun `who`, reject the month as a replacement for modal `may`, support
grammatical senses and verified inflections, and keep malformed/unsupported
entries hidden. Do not scale if the pilot publishes a wrong sense or lacks
attribution. No fixed recovery percentage is promised.

After a sound pilot, process core words by NGSL frequency, then Academic,
Business, TOEIC and Fitness membership, followed by all hidden advanced words.
Emit per-word outcomes and reason totals, including source-unavailable and
budget-deferred states. Do not mark deferred network/budget cases as verified.

## Verification and delivery

- [ ] Approve this scope, source/attribution policy, cumulative cap and delivery.
- [ ] Implement source adapters, identity checks and provenance with failing-first tests.
- [ ] Verify the 25-word pilot before applying the remaining bounded queue.
- [ ] Complete every candidate's assessment and preserve unresolved outcomes.
- [ ] Rebuild NDJSON schema, word artifacts, graph JSON and progressive galaxy assets.
- [ ] Pass strict publication audit, unit tests, TypeScript, lint and production build.
- [ ] Check browser word details, attribution, sense selection, claims and galaxy navigation.
- [ ] Review the diff for source integrity, secrets, unexpected deletions and large artifacts.
- [ ] If approved, commit and push to the existing Vercel-connected production branch;
      verify deployment success against that exact commit.

If implementation needs unattended continuation, use one quiet heartbeat in this
chat, inspecting worker state before resuming and stopping after delivery or a
terminal blocker. Never launch duplicate workers. Report meaningful failures and
the final recovered/retained counts; do not send repetitive unchanged updates.

## References checked 2026-10-13

- WordNet coverage: https://wordnet.princeton.edu/frequently-asked-questions
- Wiktionary copyright guidance: https://en.wiktionary.org/wiki/Wiktionary:Copyrights
- Structured dictionary availability: https://kaikki.org/dictionary/English/index.html
- Raw extraction downloads: https://kaikki.org/dictionary/rawdata.html
- Tatoeba reuse and attribution: https://tatoeba.org/en/terms_of_use

The Wiktionary guidance notes that external quotations can have different rights;
they are explicitly excluded unless independently cleared. Verify applicable
Wikimedia terms for actual imported material during provider implementation.
