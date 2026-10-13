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

- [x] Write failing tests for independent POS, exact case/headword, rejected quotes,
  wrong-language data, explicit inflections, source provenance and idempotent apply.
  ```ts
  expect(recoveryCandidates('who', [{word:'WHO', lang_code:'en', pos:'name', senses:[]}], 'en', stamp)).toEqual([]);
  expect(applyRecovery(record, candidates, {sense:999,example:0})).toEqual(record);
  ```
- [x] Run `npx vitest run lib/vocabulary/verification/recovery.test.ts`; observe failure.
- [x] Implement strict adapter with mapped POS, content-hash sense IDs and CC BY-SA
  source URLs. Retain provider wording; skip quotation/ref examples and unsafe tags.
  Validate with `VocabularyRecordSchema.parse`; selected examples must belong to
  the selected candidate and contain a verified whole form.
- [x] Add optional source `attribution`, `license`, `licenseUrl` metadata with safe
  HTTP(S) URLs; old records stay valid. Register the new factual source.
- [x] Apply selected sense only, hide superseded nonpublished drafts without deleting
  history; leave existing published senses/connections and record IDs intact.
- [x] Rerun targeted tests and typecheck before committing code with Task 3.

## Task 2: Bounded cached sources

Files: create `lib/vocabulary/verification/recovery-io.ts`, `recovery-io.test.ts`.

Interfaces: `RecoveryCache` owns root, cumulative disk size, cached JSON, timed
fetch, throttling and a singleton worker lock. `loadSimpleCandidates(lemmas)`
reads a size-bounded small gzip extraction into a filtered index. `englishEntries(lemma)`
reads per-word JSONL. `tatoebaExamples(lemma, forms)` returns attributable examples.

- [x] Write failing tests for oversized streamed responses, persistent cache budget,
  invalid JSON, cache reuse, 404 versus failure, and live/dead worker locking.
  ```ts
  await expect(readBounded(new Response('abcd'), 3)).rejects.toThrow('limit');
  ```
- [x] Run `npx vitest run lib/vocabulary/verification/recovery-io.test.ts`.
- [x] Implement abortable bounded reads; 404 means absent, other failures are errors.
  Validate cached envelopes, hash keys by full request/version, atomically rename.
  Minimum interval between public source requests; at most two bounded attempts,
  respect Retry-After and stop repeated infrastructure failures.
- [x] Filter Simple extraction to candidate lemmas in memory; retain only relevant
  entries. English lookup uses the observed per-word path layout and JSONL link.
- [x] Only accept Tatoeba rows with owner attribution and explicit reusable licence;
  missing metadata cannot be guessed from the generic provider label.
- [x] Verify tests, sample live sources and record returned shapes, no paid calls yet.

## Task 3: Learner attribution

Files: modify `lib/content/word-learning.ts`, its tests,
`components/network/word-learning-drawer.tsx`, its tests; add an attribution helper
component/test if needed. Regenerate `content/vocabulary/schema.json`.

Interfaces: `LearningSense.sources` and `.exampleSources` carry optional
`LearningSource[]`; `LearningExample.sources` carries optional attribution.

- [x] Write failing profile/render tests for persisted source/license links, distinct
  definition/example credit, unsafe URL rejection, and no anchors nested in buttons.
  ```ts
  expect(markup).toContain('https://creativecommons.org/licenses/by-sa/4.0/');
  expect(profile.senses[0]?.sources?.[0]?.sourceId).toBe('wiktionary');
  ```
- [x] Run targeted tests, implement links beside (not inside) sense buttons. Keep
  keyboard selection and natural card height; no new client network dependencies.
- [x] Run `npm run schema:vocabulary`, targeted tests, `npx tsc --noEmit`, full suite.
- [x] Review and commit only code/docs/source registry, not private caches.

## Task 4: Resumable recovery and pilot

Files: create `scripts/recover-vocabulary.ts`, runner tests; package script
`recover:vocabulary`; cache directory `.cache/vocabulary-repair/recovery-v2/`.

- [x] Test CLI argument parsing, finite decisions, pinned queue, no-write default,
  resume/idempotence and output reason classification before implementation.
- [x] Implement `--pilot --write` and `--write` with an explicit successful pilot
  review marker required for full rollout. Baseline candidates come from old
  unresolved outcomes and are pinned with original hashes before mutation.
- [x] Reuse source caches first; fetch English fallback when Simple evidence is
  absent, dubious or rejected. WordNet senses remain usable for Tatoeba matching.
- [x] Reserve spending before each model call using existing ledger, max 128 output
  tokens, one attempt. Prompt asks only for sense/example indexes, rejects faulty
  prose, wrong grammatical role, proper names, fragments and mismatched meaning.
- [x] Check current CNY pricing and balance; peak input2/output8 per million was
  verified on 2026-10-13; account for timeouts with full reservations.
- [x] Run `npm run recover:vocabulary -- --pilot --write`. Inspect all 25 decisions
  against supplied evidence and attribution, including withheld negative cases.
- [x] Fix defects with regression tests; never relax gates to improve a percentage.
- [x] Record pilot review, then run `npm run recover:vocabulary -- --write` once.
  Checkpoint after each batch; every unchanged/retained word still receives a reason.

## Task 5: Full pass, validation and delivery

- [x] Wait through all candidates without duplicate workers. Stop paid calls at cap
  and report deferred entries. Keep all evidence/checkpoint/ledger history.
- [x] Run `npm run lint:vocabulary`, `npm run audit:dictionary -- --strict`,
  `npm run build:graphs`, `npm test`, `npm run lint`, `npx tsc --noEmit`, `npm run build`.
- [x] Run progressive browser suite with installed Chrome and ignored local config;
  include real recovered grammar words and attribution URLs in word details.
- [x] Audit changed records, preserved list IDs/connections, unsupported outcomes,
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
are not yet pushed. Implementation was saved in local commit `1ce5960b`; content
and final generated outputs await completion. Preserve `pilot-initial-checkpoint.json` and the
original `spend.json`; they include both early pilot attempts and failures.

At 350 assessed entries, inspection exposed Tatoeba stemming `listener` to `listen`
and `provider` to `provide`. The worker was stopped (PID verified first); completed
batches and all ledger reservations were retained, including three interrupted
requests charged at their full reserved maximum. Exact query syntax was verified
against Tatoeba's search documentation and live responses; a regression test now
requires `="listener"`/exact phrases. Cache keys are versioned, preserving old data.
Old example-missing/ambiguous outcomes are requeued once for this source upgrade;
current outcomes carry `sourceQueryVersion: 3`. Technical failures remain bounded
to three recorded attempts. No successful record is reprocessed.

The three affected pilot words were reviewed again: firstly and listener recovered
with Wiktionary/Tatoeba; absolution with WordNet/Tatoeba. The pilot is now 22/25,
with three incomplete/malformed advanced entries still withheld. The review marker
was updated to the exact new hash. Resume the full worker with the normal command.
Current cumulative maximum accounting is 2.355484 CNY. Latest code checks: 586 unit
tests, TypeScript, zero ESLint errors (four existing warnings), a production build,
and actual browser checks for who/may/when attribution and enabled claim gates.

### Quality investigation during rollout — 2026-10-13 06:00

Spot-checking exposed three concrete validation gaps: article-prefixed Simple
inflection pointers ("The plural form of beam"), bibliographies embedded in
untyped English example text, and a model-approved related-but-different meaning
(markdown: a retail price reduction versus an economic forecast reduction).
Source prose for matriculate/confection also contains grammar errors. No content
has been deployed. The single worker was stopped and its saved journal replayed;
the original ledger, including interrupted reservations, was retained.

The importer now rejects those inflection variants and citation-bearing/multiline
examples, with failing-first regression coverage. This is an intentionally cautious
filter, not a claim that every multiline example is an external quotation.

Required before Task 5 delivery:

- [ ] Calibrate `npm run review:recovered-vocabulary -- --pilot`. Known bad pairs
  must be rejected; legitimate usage-based and relative-pronoun definitions must
  pass. Do not scale a critic that mistakes a grammatical definition for a defect.
- [x] Finish the ordinary recovery queue and bounded technical retries first.
- [ ] Run `npm run review:recovered-vocabulary -- --write` with no other worker.
  This final pass reuses the exact original ledger, concurrency 3, 128-output-token
  calls, and at most three conservatively charged attempts. It reviews only new
  recovered pairs, saves hash-bound decisions, and quarantines rejected senses
  without deleting any text, source, stable ID, membership or connection.
- [ ] Run the updated ignored `recovery-v2/audit-changes.ts`: every recovered pair
  needs an accepting exact-hash quality receipt, rejected pairs must be unclaimable,
  and all original source-integrity checks still apply.
- [ ] Review final retained/rejected examples and rerun the full release checks.

The initial critic calibration caught the bad examples but wrongly rejected
`who`'s relative-pronoun definition. Calibration must pass after correcting that
criterion; never relax the original factual evidence or attribution gates.

**Current release hold:** Three calibration variants were tested under the same
ledger. The last accepts who/when/because/may and rejects the known bad pairs, but
incorrectly rejects the complete sentence "It's a masterwork!" as fragment-like.
The stricter critic is therefore NOT cleared for automatic rollout. Do not try a
fourth prompt tweak without discussing this reliability problem. The user has
been asked asynchronously whether to use the model only for flags, followed by
the agent's own editorial review and conservative withholding of uncertainties;
the user would not have to review vocabulary personally. Await that answer before
changing the final review approach or deploying. Ordinary factual recovery can
continue safely with the now-tested deterministic filters. Complete its bounded
technical retries, but do not mistake that completion for release readiness.

Latest code verification: 596 unit tests passed, TypeScript passed, ESLint has no
errors and the same four existing warnings. The quality reviewer remains a gated
prototype; `quality-pilot.json` has `passed:false`. Nothing from this recovery
campaign has been pushed or deployed.

### Source assessment complete — 2026-10-13 07:00

The single worker exited successfully at 06:54. All 2,081 pinned candidates have
outcomes; no missing candidates, transient failures, pending journals or worker
locks remain. Provisional results: 373 core and 476 advanced recovered; 71 core
remain unclaimable and 1,161 advanced remain hidden. These are NOT final publishable
counts: the final review hold above still applies. Read-only deterministic scanning
flags 22 earlier accepted pairs for incomplete inflection definitions or unclear
quotation provenance; known semantic/prose failures also need review.

Cumulative maximum spending is 3.663118 CNY in the original 16 CNY ledger. New
retained source cache is 16.67 MiB. Canonical lint: 12,115 records, zero errors or
warnings. Structural dictionary audit: zero strict blockers. Those checks do not
establish sentence grammar or meaning alignment, and do not clear the release hold.

No further source worker or paid calls are needed. Stop the heartbeat pending the
user's answer about model-as-flagger plus agent editorial review. Do not rebuild,
push or deploy these provisional results as final; resume final review/delivery
only after that decision. Preserve all current files, source history and ledger.

### Approved final review approach — 2026-10-13

The user approved: "Yes—review flags yourself; keep uncertain words hidden".
This supersedes the decision hold above, not the source/attribution or budget gates.
Keep the existing critic prompt unchanged; it is a flagger, not a publication judge.

- [x] Split the review CLI into `--flags` (cached, bounded model suggestions only;
  never changes canonical content) and `--apply` (offline, explicit agent decisions
  required for every flag, bound to the exact record hash). Reject the old automatic
  `--write` mode. Test missing/stale editorial decisions fail before any mutation.
- [x] Persist this user approval separately; preserve the failed calibration report.
  Use the original cumulative ledger and a single worker to flag all 849 provisional
  recoveries. No additional source pass, fourth prompt calibration or new provider.
- [x] Agent reads every flagged definition/example and records keep/quarantine with
  a concrete reason. Do not rewrite factual text. Unclear rights, incomplete meanings,
  semantic mismatches and uncertain cases remain hidden/unclaimable. Inspect a sample
  of unflagged pairs too; agent may quarantine missed problems.
- [ ] Apply the reviewed decisions with journal protection; extend the source audit
  to verify hash-bound editorial decisions for flags rather than requiring model
  agreement. Then rebuild, test, commit/push and verify the exact production SHA.

### Final editorial review and local release checks — 2026-10-13 08:25

The automatic-review hold is resolved by the approved flags-only approach, not by
claiming the critic passed calibration. The original failed pilot remains preserved.
All 849 provisionally recovered pairs received flags. The main agent inspected all
230 flagged pairs, 75 unflagged sample pairs, and 15 additional long/quoted passages.
The 320 exact-hash editorial decisions retain 174 and quarantine 146. The other
529 unflagged pairs were not individually reread in this final editorial pass;
they retain their original factual-source and two-stage matching checks. This is
not a claim of exhaustive human-quality proofreading or zero remaining errors.

Offline application retained all text, source metadata, old sense IDs, memberships
and connections. Final outcomes for all 2,081 candidates:

| Outcome | Core | Advanced |
| --- | ---: | ---: |
| Recovered and claimable | 329 | 374 |
| No factual sense | 11 | 146 |
| No suitable sourced example | 40 | 892 |
| Ambiguous sense match | 20 | 123 |
| Withheld after final editorial review | 44 | 102 |

Remaining: 115 unique core words unclaimable and 1,263 advanced words hidden.
The repository still contains all 12,115 records; 10,852 are published, including
core records without a claimable sense. No new relationship was published.

Fresh verification: exact source/identity audit passed; canonical lint has zero
errors/warnings; strict dictionary audit has zero publication blockers. All graph,
word and progressive assets regenerated. All 598 unit tests (85 files), TypeScript,
production build and 15 Chrome browser checks passed. ESLint has zero errors and
four pre-existing unused-variable warnings. Initial sandbox-only CLI-fixture failures
were reproduced as blocked tsx IPC and passed unchanged with local IPC permissions.

Cumulative conservative spending: **4.669034 CNY** in the original ledger, including
prior work, retries and interruptions; ceiling remains 16 CNY. No further paid calls.
New source payload cache: 17,483,446 bytes (16.67 MiB; approximately 30 MiB allocated
on disk), below 250 MiB. A 512 KiB orphaned partial shard from a stopped worker was
moved into ignored recovery storage rather than deleted or committed.

Final delivery still requires the reviewed Git commit/push and exact-SHA Vercel
Production success. The old `--write` quality-review step above is obsolete; use
`--flags` followed by agent decisions and offline `--apply` only.

Final inline code review found no release blocker. The secret scan identified an
existing localhost database example in README matching local `.env`; it was replaced
with explicit username/password placeholders. Environment files were unchanged.
The repeated scan found no configured secrets, private keys or private/temp files
in the release. Largest changed artifact is the 2.04 MiB all-list graph JSON.
