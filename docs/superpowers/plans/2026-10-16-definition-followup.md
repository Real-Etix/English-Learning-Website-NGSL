# Reviewed spelling and definition follow-up

> Execute inline using executing-plans and verification-before-completion. The
> user approved reviewed spelling corrections and clearer source-grounded meanings
> on 2026-10-16. No subagents, new worktree, paid calls, commit, push or deployment.

**Goal:** Reassess all 326 remaining hidden advanced records for spelling repairs
and understandable, relevant meanings; keep unresolved and unrelated entries hidden.

**Architecture:** Pin a separate baseline and explicit decisions. Reuse the existing
hash-bound limited-example release. Preserve exact source definitions, combining a
derivative's definition with an individually selected base-word explanation when
needed. Preserve the derivative's POS, both source references and usage restrictions.
No invented examples or automatic relationship approval. A bad old relationship
is not evidence for a meaning; it stays unpublished even when a word is recovered.

**Tech stack:** TypeScript, NDJSON, existing WordNet/Wiktionary/OEWN adapters.

## Constraints and approved design

- Preserve all 12,115 IDs, all core and previously public records, six archives,
  original source prose/examples, memberships and relationship statuses.
- Correct display only: historical normalization reversals or explicitly reviewed
  spacing/hyphen variants with identical letters. Reject collisions, including
  accent/spacing/hyphen equivalents. Do not merge entries or substitute synonyms.
- Definitions are exact source excerpts plus named base definitions, not synthetic
  quotations. Each lexical/semantic composition is individually reviewed; the
  runner cannot infer approval. An unclear base definition is not enough.
- Free cached evidence first, then sequential public no-key dictionary requests:
  1.1-second spacing, 25-second timeout, 2 MiB response, 250 MiB shared cache cap.
  Stop new requests after three consecutive failures. No spend-ledger changes.
- All newly selected senses remain meaning-only; claims enabled, sentence practice
  disabled. No frontend redesign or changes to the publication policy.
- Existing plans/specs remain historical. This is the targeted follow-up the user
  approved, not a restart of the completed prior queues.

## Tasks

- [x] Pin 326 hidden records and all protected hashes under
  `.cache/vocabulary-repair/definition-followup/`; inspect worker lock/processes.
- [x] Add failing punctuation/collision tests in `lib/vocabulary/editorial.test.ts`,
  minimally extend the reviewed formatting guard, run the editorial tests.
- [x] Read all remaining reasons/definitions/anchors. Record explicit decisions in
  `content/vocabulary/definition-review-batches/`. For each release bind exact
  source sense IDs and explanatory senses, source hashes and the starting record.
- [x] Validate a small pilot. Apply each reviewed batch using existing pure
  applicators under the recovery lock with backups; repeat to prove idempotence.
- [x] Rebuild word/graph/galaxy artifacts. Verify all new profiles/search entries,
  all holds absent, source preservation and unchanged protected record hashes.
- [x] Run strict dictionary audit, vocabulary lint, full tests (one worker), ESLint,
  production build, desktop/mobile browser regressions and `git diff --check`.
- [x] Reconcile all 326 final decisions, update this report and leave changes local.

## Verification commands

`npm test -- lib/vocabulary/editorial.test.ts --maxWorkers=1`

`node --import tsx scripts/build-word-data.ts`

`node --import tsx scripts/build-graph-data.ts`

`node --import tsx scripts/build-galaxy-assets.ts`

`node --import tsx scripts/audit-dictionary.ts --strict`

`node --import tsx scripts/lint-vocabulary.ts`

`npm test -- --maxWorkers=1 --testTimeout=15000`

`npm run lint` and `npm run build`

`npx playwright test --config=.cache/definition-followup-playwright.config.ts tests/e2e/limited-example-release.spec.ts tests/e2e/matching-repair.spec.ts tests/e2e/definition-followup.spec.ts --workers=1`

`git diff --check`

## Applied review outcomes

All **326** pinned records have explicit final decisions: **92 published**, **234
withheld**, **0 pending**. This includes retaining the six existing archives. The
local corpus contains **11,881 public records** out of **12,115**, with all **5,981
core records** unchanged. The separate 115-core-word claimability backlog was not
part of this advanced-word pass.

| Batch | Reviewed | Published | Withheld |
| --- | ---: | ---: | ---: |
| 001 (pilot) | 6 | 6 | 0 |
| 002 | 20 | 20 | 0 |
| 003 | 23 | 23 | 0 |
| 004 | 31 | 31 | 0 |
| 005 | 12 | 12 | 0 |
| 006 | 234 | 0 | 234 |
| Total | 326 | 92 | 234 |

Each batch was previewed, applied and applied again with zero changes on repeat.
The global limited-example manifest now contains 1,029 release receipts and 234
holds; its full dry run also reports zero changes. That receipt count is distinct
from the audit's 1,028 currently example-limited senses: a previous released sense
already has a factual example.

Seven display corrections preserve stable IDs: `macro-economist` →
`macroeconomist`, `house-made` → `housemade`, `pressup` → `press-up`,
`micro-economist` → `microeconomist`, `soire` → `soirée`, `semi-diameter` →
`semidiameter`, and `gram-molecule` → `gram molecule`. The reviewed spelling guard
now permits spacing/hyphen differences without letter substitutions and rejects
accent/punctuation-equivalent collisions. Two new tests failed before that guard
change and passed afterward; all seven editorial tests pass.

Short source definitions such as a derivative “of X” are retained verbatim and
followed by a separately named, individually selected definition of X. This makes
meanings understandable without presenting an invented paraphrase as a dictionary
quotation. All 92 selected senses are claimable through meanings, but none unlocks
example-dependent sentence practice. Original meanings/examples remain preserved.
Usage labels, source URLs and hashes are retained. `doppelgänger`, `soirée` and
`artisanal` were recovered with direct current English-entry evidence where an
older extracted lookup was incomplete.

The 234 holds are final reviewed decisions for this pass, not an unprocessed
queue. Per-word reasons remain in batch 006: unresolved spelling/identity,
unclear or conflicting definitions, duplicates, register ambiguity, and specialist
meanings unrelated to their learning context. For example, `fte` would collide
with the existing public `fete`; `monosaccharide` has conflicting/overrestrictive
source definitions; the biological sense of `aerophilic` does not establish an
exercise meaning. An unsuccessful lookup is not proof that a word is invalid.

## Source and preservation audit

- Reused cached Wiktionary, local WordNet and available OEWN evidence before
  bounded free lookups. No dictionary subscription, credentials, paid LLM calls,
  model-based approval or spend-ledger changes.
- The source-helper ledger records 99 uncached lookup attempts: three initial
  sandbox connection failures and 96 completed lookups. These are lookup counts,
  not a claim about underlying HTTP retries. Additional direct Wiktionary page
  checks were read manually; five exact licensed English definitions are retained
  in `content/vocabulary/definition-review-sources.json`. No book quotations or
  invented examples were imported.
- The shared retained source cache is **2,270,695 bytes**, below the 250 MiB cap.
  No dictionary dump was downloaded.
- `.cache/vocabulary-repair/definition-followup/validation.json` checks every
  released profile/search entry, every withheld hash, all protected core/prior
  public hashes, stable IDs, original source prose/examples, memberships,
  connections and unchanged spending. All checks passed; no worker lock remains.
- The 15,528 published source connections are unchanged. New releases are
  searchable as unconnected stars in **All words**, without promoting old
  suggested links or inventing official list membership. The five list graphs
  retain 4,386 NGSL, 1,998 TOEIC, 2,901 Business, 1,546 Academic and 886 Fitness
  stars. The All words graph now has 11,881 stars.

## Verification results

- Word profiles, graph JSON and progressive galaxy assets rebuilt successfully.
- Strict dictionary audit: **zero blocking violations**. Vocabulary lint:
  **12,115 records, zero errors or warnings**.
- Full Vitest suite: **646 tests in 91 files passed**. The first sandboxed run
  could not open tsx IPC sockets. An unsandboxed run concurrent with the build
  hit two fixture timeouts; rerunning after the build passed in 21.44 seconds
  without changing assertions or the 15-second per-test timeout.
- ESLint: **zero errors**, four existing unused-variable warnings outside this
  pass's changes.
- Next.js production build, including TypeScript and static-page generation:
  **passed**. No deployment was made.
- Desktop/mobile browser checks exercised all **20 scenarios** at 1280px and
  390px, with every scenario passing at least once. All eight new-word scenarios
  passed on the first run. The initial full run passed 19/20; the existing
  `miscible` mobile case timed out after five seconds while its drawer was still
  loading. Its trace shows a successful but delayed mocked word response
  (approximately three seconds), not a rejected definition. Three consecutive
  isolated retests passed unchanged (9.1s, 7.0s and 5.9s total test duration).
  This timing-related test flake is recorded, not presented as a clean first run.
  API routes were mocked throughout: no paid calls or database writes. Browser
  processes and the temporary production server exited after the checks.
- Screenshots inspected: the long `entrepreneurialism` meaning fits the mobile
  drawer with its attribution and claim button; desktop `press-up` displays the
  corrected spelling, regional labels and complete sourced exercise meaning.
- `git diff --check`: **passed**. Spending remains unchanged; no recovery worker
  lock is present.

Review and implementation were performed inline, respecting the no-subagents
constraint. The branch and all pre-existing changes are preserved. No commit,
push, deployment or remote database mutation is part of this pass.
