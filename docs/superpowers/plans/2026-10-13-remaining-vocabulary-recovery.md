# Remaining vocabulary recovery implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: executing-plans. Execute inline;
> the user explicitly prohibits subagents. Continue until delivery or a real blocker.

**Goal:** Assess the 2,081 remaining records using additional factual sources,
publish safe senses, expose attribution, preserve unsupported records, deploy.

**Architecture:** Separate pure source normalization/selection from bounded HTTP
and the resumable worker. Leave the completed old runner/checkpoint intact.
Keep canonical NDJSON and current static build/runtime boundaries.

**Tech Stack:** TypeScript, Zod, Node fetch/zlib, Vitest, Next.js 16, React 19.

## Global constraints

- Use one worker, batches of 25 and at most three concurrent requests. No subagents.
- Use `.cache/vocabulary-repair/spend.json`, cumulative ceiling 16 CNY, already
  charged 1.64935 CNY. No new ledger, top-ups or providers for model calls.
- New retained cache ceiling 250 MiB. No large complete English dictionary dump.
- Preserve exact source text, stable IDs, list membership, progress and connections.
- No quotes/audio without established rights, no generated factual content.
- Native examples ALSO undergo quality/sense selection: inspection found poor
  Simple Wiktionary prose for `might`. Abstention is a valid outcome.
- Existing checkout is clean; work in place to reuse bounded cache/ledger and avoid
  duplicating the corpus/dependencies. Production push explicitly approved.
- Read installed Next docs before UI edits (server/client guide read).

## Task 1: Source candidates and safe application

Files: create `lib/vocabulary/verification/recovery.ts`, `recovery.test.ts`;
modify `lib/vocabulary/schema.ts`, `content/vocabulary/sources.json`.

Interfaces: `recoveryCandidates(lemma, entries, edition, retrievedAt)` returns
`RecoveryCandidate[]` with `sense: VocabularySense`, `forms: string[]`.
`applyRecovery(record, candidates, decision)` accepts exact numeric sense/example
indexes or null and returns a canonical record. No edits to the legacy verifier.

- [ ] Write failing tests for independent POS, exact case/headword, rejected quotes,
  wrong-language data, explicit inflections, source provenance and idempotent apply.
  ```ts
  expect(recoveryCandidates('who', [{word:'WHO', lang_code:'en', pos:'name', senses:[]}], 'en', stamp)).toEqual([]);
  expect(applyRecovery(record, candidates, {sense:999,example:0})).toEqual(record);
  ```
- [ ] Run `npx vitest run lib/vocabulary/verification/recovery.test.ts`; observe failure.
- [ ] Implement strict adapter with mapped POS, content-hash sense IDs and CC BY-SA
  source URLs. Retain provider wording; skip quotation/ref examples and unsafe tags.
  Validate with `VocabularyRecordSchema.parse`; selected examples must belong to
  the selected candidate and contain a verified whole form.
- [ ] Add optional source `attribution`, `license`, `licenseUrl` metadata with safe
  HTTP(S) URLs; old records stay valid. Register the new factual source.
- [ ] Apply selected sense only, hide superseded nonpublished drafts without deleting
  history; leave existing published senses/connections and record IDs intact.
- [ ] Rerun targeted tests and typecheck before committing code with Task 3.

## Task 2: Bounded cached sources

Files: create `lib/vocabulary/verification/recovery-io.ts`, `recovery-io.test.ts`.

Interfaces: `RecoveryCache` owns root, cumulative disk size, cached JSON, timed
fetch, throttling and a singleton worker lock. `loadSimpleCandidates(lemmas)`
reads a size-bounded small gzip extraction into a filtered index. `englishEntries(lemma)`
reads per-word JSONL. `tatoebaExamples(lemma, forms)` returns attributable examples.

- [ ] Write failing tests for oversized streamed responses, persistent cache budget,
  invalid JSON, cache reuse, 404 versus failure, and live/dead worker locking.
  ```ts
  await expect(readBounded(new Response('abcd'), 3)).rejects.toThrow('limit');
  ```
- [ ] Run `npx vitest run lib/vocabulary/verification/recovery-io.test.ts`.
- [ ] Implement abortable bounded reads; 404 means absent, other failures are errors.
  Validate cached envelopes, hash keys by full request/version, atomically rename.
  Minimum interval between public source requests; at most two bounded attempts,
  respect Retry-After and stop repeated infrastructure failures.
- [ ] Filter Simple extraction to candidate lemmas in memory; retain only relevant
  entries. English lookup uses the observed per-word path layout and JSONL link.
- [ ] Only accept Tatoeba rows with owner attribution and explicit reusable licence;
  missing metadata cannot be guessed from the generic provider label.
- [ ] Verify tests, sample live sources and record returned shapes, no paid calls yet.

## Task 3: Learner attribution

Files: modify `lib/content/word-learning.ts`, its tests,
`components/network/word-learning-drawer.tsx`, its tests; add an attribution helper
component/test if needed. Regenerate `content/vocabulary/schema.json`.

Interfaces: `LearningSense.sources` and `.exampleSources` carry optional
`LearningSource[]`; `LearningExample.sources` carries optional attribution.

- [ ] Write failing profile/render tests for persisted source/license links, distinct
  definition/example credit, unsafe URL rejection, and no anchors nested in buttons.
  ```ts
  expect(markup).toContain('https://creativecommons.org/licenses/by-sa/4.0/');
  expect(profile.senses[0]?.sources?.[0]?.sourceId).toBe('wiktionary');
  ```
- [ ] Run targeted tests, implement links beside (not inside) sense buttons. Keep
  keyboard selection and natural card height; no new client network dependencies.
- [ ] Run `npm run schema:vocabulary`, targeted tests, `npx tsc --noEmit`, full suite.
- [ ] Review and commit only code/docs/source registry, not private caches.

## Task 4: Resumable recovery and pilot

Files: create `scripts/recover-vocabulary.ts`, runner tests; package script
`recover:vocabulary`; cache directory `.cache/vocabulary-repair/recovery-v2/`.

- [ ] Test CLI argument parsing, finite decisions, pinned queue, no-write default,
  resume/idempotence and output reason classification before implementation.
- [ ] Implement `--pilot --write` and `--write` with an explicit successful pilot
  review marker required for full rollout. Baseline candidates come from old
  unresolved outcomes and are pinned with original hashes before mutation.
- [ ] Reuse source caches first; fetch English fallback when Simple evidence is
  absent, dubious or rejected. WordNet senses remain usable for Tatoeba matching.
- [ ] Reserve spending before each model call using existing ledger, max 128 output
  tokens, one attempt. Prompt asks only for sense/example indexes, rejects faulty
  prose, wrong grammatical role, proper names, fragments and mismatched meaning.
- [ ] Check current CNY pricing and balance; peak input2/output8 per million was
  verified on 2026-10-13; account for timeouts with full reservations.
- [ ] Run `npm run recover:vocabulary -- --pilot --write`. Inspect all 25 decisions
  against supplied evidence and attribution, including withheld negative cases.
- [ ] Fix defects with regression tests; never relax gates to improve a percentage.
- [ ] Record pilot review, then run `npm run recover:vocabulary -- --write` once.
  Checkpoint after each batch; every unchanged/retained word still receives a reason.

## Task 5: Full pass, validation and delivery

- [ ] Wait through all candidates without duplicate workers. Stop paid calls at cap
  and report deferred entries. Keep all evidence/checkpoint/ledger history.
- [ ] Run `npm run lint:vocabulary`, `npm run audit:dictionary -- --strict`,
  `npm run build:graphs`, `npm test`, `npm run lint`, `npx tsc --noEmit`, `npm run build`.
- [ ] Run progressive browser suite with installed Chrome and ignored local config;
  include real recovered grammar words and attribution URLs in word details.
- [ ] Audit changed records, preserved list IDs/connections, unsupported outcomes,
  source/licence metadata, secret scan and artifact size. `git diff --check`.
- [ ] Commit, push existing `cursor/ngsl-mood-trainer` using authenticated HTTPS
  helper; verify GitHub Vercel Production deployment at the exact commit SHA.
- [ ] Save ignored delivery receipt, stop continuation heartbeat, report final
  counts, spending and unresolved reasons without claiming every word is verified.

## Continuation

No active worker at start. Preserve the old `delivery.json`. New checkpoint/report
and worker lock belong to recovery-v2; old ledger stays at its existing root.
Read this plan and approved spec on continuation. Check process/lock first.
Baseline: all 559 tests pass with required sandbox permissions for CLI IPC.

### Implementation checkpoint — 2026-10-13

Tasks 1–3 are implemented and tested, including distinct learner-facing definition
and example attribution. Task 4 is implemented with a shared lock, original budget
ledger, pinned hashes, a write-ahead batch journal and group-level failure circuit
breaker. Full rollout is now running after the reviewed pilot; do not duplicate it.

The initial pilot exposed Simple Wiktionary's nontraditional grammar labels and
an unsuitable primary noun sense for `might`. The initial 25 results were archived
locally, and only their hash-verified edits were restored to the original baseline
before rechecking. Core function words now require an appropriate source POS;
source labels are never rewritten. Bare inflection pointers are excluded. A second
model call independently checks definition completeness, finite sentence structure,
sense/POS match and naturalness, with all four checks required.

The reviewer initially omitted the JSON keyword required by DeepSeek JSON mode.
The resulting 400s were charged conservatively in the original ledger. A regression
test and a three-word live check confirmed the fix before the pilot resumed. At
pilot completion: 19 recovered, six withheld, cumulative maximum 1.818684 CNY.
`pilot-review.json` records the exact reviewed report hash. Definitions/examples
and attribution were inspected for all 25 outcomes. The full run started with 2,056
remaining candidates. The six withheld pilot entries are not automatically retried.

Checks so far: 585 unit tests and TypeScript passed; 12,115 records linted with zero
errors/warnings; no strict publication blockers; pilot graph generation and Next
production build passed; 14 existing progressive browser tests passed. Additional
actual-word attribution browser coverage is being run. Added a tested 3-second
deadline for optional live DictionaryAPI detail requests to avoid blocking the
new stored content during that provider's outage. Final release checks must run
again after the full canonical-data pass and regeneration.

No subagents are used, including review. Working changes and generated artifacts
are not yet committed/pushed. Preserve `pilot-initial-checkpoint.json` and the
original `spend.json`; they include both early pilot attempts and failures.
