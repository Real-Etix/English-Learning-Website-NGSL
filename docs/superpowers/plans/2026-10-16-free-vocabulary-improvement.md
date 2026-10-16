# Free vocabulary improvement implementation plan

> **For agentic workers:** Use executing-plans inline, without subagents. Steps use checkbox tracking.

**Goal:** Repair reviewed malformed identities, enforce topic restrictions and evaluate free source improvements without publishing uncertain content.

**Architecture:** Keep stable record IDs and source text in canonical NDJSON. Optional editorial metadata controls corrected headwords and allowed learning lists. A bounded offline-first evidence evaluator collects review candidates separately from publication.

**Tech Stack:** TypeScript, Zod, Vitest, NDJSON, existing Next.js 16 routes and graph builders.

## Global constraints

- No paid calls, new accounts, subagents, hard deletion, automatic publication, or production push.
- Preserve official core entries and all existing IDs/source wording.
- Only the pinned 1,263 hidden advanced records enter this pass.
- New retained cache <=250 MiB; response <=2 MiB; timeout <=25 seconds; sequential requests >=1 second apart.
- Uncertain relevance remains unreviewed, not archived.

### Task 1: Editorial identity and scope gates

Files: `lib/vocabulary/schema.ts`, `lib/vocabulary/editorial.ts`, `lib/vocabulary/editorial.test.ts`, `lib/vocabulary/publication.ts`, `lib/vocabulary/graph-input.ts`, `lib/vocabulary/graph.ts`, `app/api/word/[lemma]/route.ts`.

Interfaces: `dictionaryHeadword(record): string`; `applyEditorialDecision(record, decision, records): VocabularyRecord`; optional `editorial.headword` and `editorial.scope` fields; graph projection `allowedLists?: string[]`.

- [x] Write tests using `vocabularyRecordFixture`: damaged `foodprocessor` receives headword `food processor` without changing lemma; reject core changes and collisions; repeated application is identical.
- [x] Add tests proving archived advanced records are never public and Fitness-only advanced nodes cannot enter Business through an otherwise valid edge.
- [x] Run `npm test -- lib/vocabulary/editorial.test.ts lib/vocabulary/graph.test.ts` and observe the new failures.
- [x] Implement schema and pure helpers, project scope into graph input, filter list selection, and use the reviewed headword for live dictionary lookup.
- [x] Rerun focused tests and `npx tsc --noEmit`.

### Task 2: Free source evidence adapter

Files: `lib/vocabulary/verification/open-english-wordnet.ts`, corresponding test; `content/vocabulary/sources.json`.

Interface: `openEnglishWordnetCandidates(headword, payload, retrievedAt): VocabularySense[]`. Source ID `oewn`; imported statuses always `review`.

- [x] Test exact returned headword/POS identity, unrelated members, malformed responses, no-example senses, member-specific forms and external quotation exclusion.
- [x] Observe failures, then implement bounded source parsing preserving exact definitions and attribution.
- [x] Run adapter tests before live requests. Do not add a provider account or API key.

### Task 3: Offline-first assessment and reviewed application

Files: `scripts/assess-free-vocabulary.ts`, `lib/vocabulary/verification/free-assessment.test.ts`, `content/vocabulary/editorial-decisions.json`.

Interface: an assessment report containing per-word original blocker, headword candidates, cached factual definitions/topics, existing anchors, OEWN evidence and an explicit decision status. Reviewed decisions are hash-pinned and applied only with `--write`.

- [x] Test argument bounds, pinned candidates, exact cache identity, no network in offline mode, failed-request handling and write preconditions.
- [x] Implement whole-remainder offline assessment and a limited OEWN pilot, defaulting to no writes or remote calls.
- [x] Review potential identity corrections against source wording and anchor meaning. Record confirmed headwords and scope decisions with explanations; do not guess the rest.
- [x] Apply reviewed decisions and append factual candidate senses in review, preserving previous content. Repeated runs must be no-ops.

### Task 4: Generated artifacts and verification

- [x] Verify total records remain 12,115 and every core record is byte-equivalent before/after.
- [x] Run `npm run schema:vocabulary`, `npm run build:graphs`, `npm test`, `npx tsc --noEmit`, `npm run lint`, and `npm run build`.
- [x] Inspect actual edited records, graph scope and attribution; check `git diff --check` and unchanged spend ledger.
- [x] Record counts of repaired identities, reviewed scopes, archives and new review candidates separately from publication. Report remaining review work explicitly; do not imply all 1,263 became claimable.

## Local outcome (2026-10-16)

- Assessed all 1,263 pinned advanced records offline; cached Wiktionary definitions
  existed for 1,037, with 1,580 sense-specific lexical relations retained as report
  evidence only. These are not approved galaxy connections.
- The 25-request OEWN pilot had no transport/schema failures: 19 words had exact
  dictionary definitions and one had target-word examples. The new source cache
  is 25 files / 16,589 bytes. No paid API calls or dictionary subscriptions.
- Applied 39 explicit agent-reviewed decisions: 16 corrected headwords,
  29 included topic scopes and six recoverable archives (categories overlap).
  Added 36 factual sense candidates in review: 17 OEWN and 19 cached Wiktionary.
- Archived: allotherian, saurian, xerophyte, zwitterion, spicule, recombination.
  These decisions concern unsuitable existing learning-list anchors, not a claim
  that the words are invalid English. Original records, definitions and links remain.
- All 12,115 stable IDs remain; all 5,981 core records are byte-identical to HEAD.
  Original source references, sense objects and connections are unchanged.
  Re-running the reviewed write produced zero changes.
- Publication remains 10,852 public / 1,263 hidden, including six archived records.
  No word was made claimable. The 115 unclaimable core entries remain unchanged.
  This pass does not claim to have editorially reviewed the other 1,224 records.
- Source reporting now derives providers from the registry rather than silently
  omitting Wiktionary/OEWN. Current source-presence counts include Wiktionary 855
  and OEWN 17; these are record counts, not independently verified claim totals.
- Schema and graph assets regenerated successfully; public graph artifacts are
  unchanged. Full validation: 612 tests / 88 files with two workers; TypeScript;
  production build; strict dictionary audit with zero release-blocking violations;
  lint with zero errors and four pre-existing unused-variable warnings.
- An unrestricted test run timed out one existing CLI test while builders were
  concurrent. That test passed alone and the entire suite passed with two workers;
  no timeout was increased to mask it. ESLint now ignores local .cache helpers.
- Spending ledger SHA-256 unchanged:
  dc724adaaefc3784c93ca88bfd563eee8d6537a8e1e984563ada8939f85b13a2.
- No commit, push or deployment. Existing checkout and user state retained.

## Remaining work, not represented as completed

- Review more cached meanings and the approved limited-example release policy;
  this preparation pass deliberately leaves the publication/claim gates intact.
- Repair other identities only when exact dictionary identity and intended sense
  agree. OEWN no-match is not proof that a word is invalid; Wiktionary confirmed
  the spellings doppelgänger, canapé and business day when OEWN did not match them.
- Review list-specific core meanings separately. Fitness crossover currently has
  a music meaning; lizard/cactus/needle also show general meanings, and Business
  buffer should be checked in its workplace context. Official entries were not
  deleted or silently changed here.
- Do not treat source-only matches, medical/scientific labels, or a missing example
  as automatic publication or exclusion. Uncertain scope stays under review.

## Follow-up: retain explicit Wiktionary usage evidence

The user reaffirmed the free-only plan. Continue the approved evidence-extraction
scope inline in this checkout; no subagents, paid calls, new subscriptions,
publication changes or deployment. The separate limited-example release has
already published 26 reviewed records; do not replay or undo that release.

### Task 5: Sense-bound usage extraction

Files: `lib/vocabulary/verification/free-assessment.ts` and its test file.

Interface: extend `cachedWiktionaryEvidence` with `usage: CachedUsageEvidence[]`,
where each item holds `senseId`, `field` (`tags`, `raw_tags`, `qualifier`, `topics`),
`scope` (`entry`, `sense`), exact `text`, `source` and `status: "review"`.
The source hash covers the exact raw scope containing the evidence. Preserve
definitions, candidate IDs and existing publication statuses. Do not turn labels,
derived terms, glossary links or synonyms into invented usage patterns/collocations.

- [x] Add a failing test for `raw_tags: ["with to"]` and `qualifier` retaining
  exact text and source attribution; existing `usagePatterns` stays empty.
- [x] Test that rejected/foreign senses contribute neither usage nor topics;
  identical raw senses in different parts of speech stay attached to distinct IDs.
- [x] Test that malformed optional data is skipped locally and duplicates do not
  produce duplicate evidence. External quotations remain excluded from examples.
- [x] Run `npm test -- lib/vocabulary/verification/free-assessment.test.ts --maxWorkers=1`
  to observe failures, implement the extractor, then rerun it plus recovery tests.

### Task 6: Refresh the offline review report

Files: `scripts/assess-free-vocabulary.ts`, `README.md`.

- [x] Include `wikiUsage` and current publication state in each assessment row;
  label the original recovery blocker as historical in documentation. Summarize
  total usage evidence, words with usage evidence and the currently hidden subset.
- [x] Run `node --import tsx scripts/assess-free-vocabulary.ts` without `--write`
  or a request limit: zero remote/paid calls and zero canonical writes.
- [x] Inspect real examples (e.g. `indebted` with `with to`, grammatical and topic
  labels) and distinguish source evidence from editorially approved meanings.
- [x] Run focused and full tests, TypeScript, lint, strict dictionary audit and
  `git diff --check`. Verify canonical shard hashes and the spend ledger are
  unchanged from the start of this follow-up. No artifact rebuild is necessary
  when neither runtime code nor canonical vocabulary changes.
- [x] Document results and remaining work; leave the existing changes local.

### Follow-up outcome (2026-10-16)

- Reassessed the pinned 1,263 records entirely offline: zero requests, paid calls
  or canonical writes. Current cohort: 26 public, 1,237 hidden (six archived).
- Retained 3,988 exact usage evidence items across 739 words; 726 of those words
  are currently hidden. Fifty-one words have free-text raw usage tags/qualifiers.
  Grammar/register/topic labels make up the rest, not newly authored patterns.
- Scoped source matching now includes the original POS entry, avoiding attaching
  a verb's evidence to a noun with identical raw sense text. Rejected senses no
  longer contribute topic evidence; duplicate evidence is removed. The refreshed
  report contains 1,500 lexical relations, still not published galaxy edges.
- Reviewed cached examples include `indebted` (`with to`), the different subjects
  of `effervesce`, and usage warnings for `beamer`. The Wiktionary warning on
  `acylglycerol` belongs to a different, unreleased Wiktionary sense; its existing
  published OEWN sense was not changed or conflated with that evidence.
- Six new regression tests were observed failing before implementation. Focused
  tests: 25 passing. Full suite: 641 tests / 91 files, one worker. TypeScript and
  strict dictionary audit passed; lint has zero errors and the same four inherited
  unused-variable warnings. `git diff --check` passed. No runtime or corpus changes
  in this follow-up, so no new build or graph generation was needed.
- All 12,115 canonical records unchanged from the start of this follow-up:
  combined ordered shard SHA-256
  `1cec4c40fa6a400e0bc679783b2e2aa9b00dd14d02a2c9354e75ed8fc5e92d58`.
  Spending ledger hash remains the value recorded above. The worker lock was
  released normally; no subagents or background workers were started.
- Evidence report: `.cache/vocabulary-repair/free-improvement-v1/report.json`
  (7,124,129 bytes, ignored by Git). No new source-cache files or dictionary dump.
- Further editorial review, more free OEWN lookups beyond the existing 25-word
  pilot, and any future licensed learner dictionary remain separate work. No
  subscription, commit, push or deployment was performed.
