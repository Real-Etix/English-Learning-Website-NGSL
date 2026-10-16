# Final free review and recoverable retirement

> Execute inline using executing-plans and verification-before-completion. The
> user requested one final round, then discarding everything still hidden.
> No subagents, paid calls, new worktree, commit, push or deployment.

**Goal:** Resolve the pinned 234 hidden advanced entries once, publish only
verified relevant meanings, then remove unresolved entries from canonical shards
and the active review queue with a small, recoverable archive.

**Architecture:** Reuse the hash-bound limited-example release pipeline. Pin the
234 candidates plus hashes of all other records. Final explicit decisions must
cover each candidate exactly once. Retirement is an offline data migration: only
hidden advanced records without official memberships may be removed; inbound
unpublished connections are archived and pruned. Any published connection to a
retirement target aborts the operation. Preserve all core/public meanings, IDs,
examples, memberships and published relationships. Preserve archive records and
indexed incoming connections so they can be restored without overwriting newer
unrelated changes. Never mutate the deployed database or saved learner spaces.

**Tech stack:** Existing TypeScript/NDJSON maintenance scripts, Vitest, factual
WordNet/Wiktionary evidence and individually checked free government glossaries.

## Authorized scope

- The prior 326-word pass is finished; this pass starts with its 234 holds.
- Limited examples are allowed, but meaning claims require an explicit review;
  sentence practice remains disabled without an appropriate sourced example.
- Free, bounded evidence only. Reuse the same source cache and worker lock. Keep
  spending unchanged. No huge dictionary download. Any fresh source must have
  clear attribution and redistribution terms.
- Retain the six previously archived entries in the recovery copy, not the live
  canonical corpus. Do not rename them, merge collection IDs or invent definitions.
- Remove only unpublished links to discarded targets, preserving exact indexed
  copies. No source prose or example is deleted from retained words.
- Historical review manifests remain audit records, not commands to rerun against
  the reduced corpus. Remove retired IDs from active editorial/withheld queues.

## Tasks and verification

- [x] Pin current 234 candidates, protected records and spend hash; check lock and
  processes. Inspect each previous reason and learning anchor. Re-check useful
  missing/circular factual senses with free sources; avoid retrying clear topic
  mismatches as though they were missing-example cases.
- [x] Record explicit release choices in
  `content/vocabulary/final-review-batches/001.json` and final retirement decisions
  in `002.json`. Reuse the previous pure release applicators; preview, write, and
  repeat to check zero changes. No automatic source-match approvals.
- [x] Test the retirement transform before implementation in
  `lib/vocabulary/retirement.test.ts`: only hash-matched hidden advanced records,
  reject core/public/missing/duplicate IDs and published inbound links; preserve
  retained content and archive incoming edges in their original order.
  Run `npm test -- lib/vocabulary/retirement.test.ts --maxWorkers=1` red then green.
- [x] Use the tested transform in an offline guarded migration, snapshot its exact
  targets under `content/vocabulary-retired/2026-10-16/` before changing canonical
  files, and verify the archive hashes. Check each shard's before/after hash so
  an interrupted run can resume and refuses unrelated concurrent edits.
  Validate zero dangling/reciprocity errors before writing; never delete a root
  directory or use broad filesystem deletion.
- [x] Rebuild canonical manifest/checksums and generated word/graph/galaxy assets.
  Verify active records = prior 12,115 minus retired; no hidden advanced records;
  old public IDs unchanged, new releases claimable, retired IDs absent from search
  and runtime word data; source text and examples preserved for every survivor.
- [x] Run vocabulary lint, strict audit, full tests (one worker), ESLint, production
  build and desktop/mobile regressions. Use existing local mocked browser tests;
  no live account/database writes. Run `git diff --check`.
- [x] Reconcile all 234 decisions and document released/retired totals, recovery
  instructions and verification evidence. Leave all changes local.

## Commands

`node --import tsx scripts/build-word-data.ts`

`node --import tsx scripts/build-graph-data.ts`

`node --import tsx scripts/build-galaxy-assets.ts`

`node --import tsx scripts/lint-vocabulary.ts`

`node --import tsx scripts/audit-dictionary.ts --strict`

`npm test -- --maxWorkers=1 --testTimeout=15000`

`npm run lint` then `npm run build`

`npx playwright test --config=.cache/final-review-playwright.config.ts tests/e2e/final-review.spec.ts tests/e2e/definition-followup.spec.ts --workers=1`

`git diff --check`

## Applied outcome

All 234 pinned candidates have final explicit decisions. Batch 001 published
**11**: bactericide, electrotechnician, psychopathological, negatron, chromatid,
monosaccharide, cybernetically, enunciator, modulator, secessionist and recalibrate.
Batch 002 retired **223**, including the six prior archives. Limited examples do
not unlock sentence practice. No original source prose/examples were rewritten;
the new meanings preserve exact excerpts, source attribution and restrictions.

Retirement removed those 223 records and 1,046 unpublished incoming connections
from the active library. It preserved all 15,528 published connections and every
core/prior-public meaning, example, ID and membership. The recovery archive is
4,028,439 bytes with SHA-256
`f9cf0afd0d67a3ce81b60e346028871b264881ce174f824a2de28034cc670ba1`.
It contains exact records, indexed links and original metadata. Recovery is
documented in `content/vocabulary-retired/2026-10-16/README.md`; no database or
learner collection was changed. A repeated retirement dry-run reports zero edits.

The active library has **11,892 public records**, **0 hidden advanced records**,
5,981 core records and 5,911 advanced records. The 115 unclaimable core words are
preserved, outside this pass. All five official graph counts are unchanged:
NGSL 4,386; TOEIC 1,998; Business 2,901; Academic 1,546; Fitness 886.
The original 1,263-word review cohort is now 1,040 released / 223 retired.

## Verification evidence

- The five retirement tests failed against the initial missing implementation,
  then passed against the guarded transform.
- Full Vitest: **651 passed across 92 files**. Two CLI tests formerly depended on
  real hidden records; they now create an isolated temporary draft and retain
  their original budget-exhaustion and actual-token assertions. The source-count
  fixture now includes the two new factual providers with zero counts.
- Vocabulary lint: **11,892 records, zero errors/warnings**. Strict dictionary
  audit: **zero violations** in every blocking category. Historical hidden senses
  and unreviewed relationships are still retained within surviving records;
  they are not automatically learner-facing.
- All generated word, graph and galaxy assets rebuilt. The local verifier checks
  every survivor against before/after hashes, all 223 discarded IDs against their
  pinned records, all 11 releases' claim/practice flags, official list counts,
  source/example preservation and removal from runtime/search artifacts.
- The active limited-example release manifest dry-run reviews 1,040 entries and
  reports **zero changes / zero withheld**. Historical cohort assessment scripts
  must not be replayed against the reduced corpus.
- ESLint: **zero errors, four existing unused-import/variable warnings** outside
  this pass. Production build and its TypeScript check passed. All 14 Next.js
  output traces exclude the recovery archive.
- Desktop/mobile browser coverage: all 14 scenarios have passing results. An
  initial test selector confused two valid Wiktionary citations; it now checks
  each URL independently. The subsequent full run passed 13/14, with one desktop
  chromatid timing timeout. That exact case then passed **3/3** repetitions with
  unchanged assertions and the same 45-second timeout (6.9s, 8.0s, 42.8s). This
  is functional verification, not a performance guarantee. Mobile/desktop
  screenshots were inspected for clear definitions, source links, restrictions,
  claim access and no horizontal overflow. API calls were mocked throughout.
- Final `tsc --noEmit` and `git diff --check` passed. The recovery worker lock is
  absent after completion; no background repair process was launched.
- Paid calls: **zero**. The spend-ledger SHA remains
  `dc724adaaefc3784c93ca88bfd563eee8d6537a8e1e984563ada8939f85b13a2`.
  Retained free-source cache: 2,406,324 bytes, below 250 MiB.
- Inline code/data review used instead of a reviewer subagent, honoring the
  user's no-subagent instruction. Existing unrelated working-tree changes were
  preserved. No commit, push, deployment or paid service calls.

Local receipts: `.cache/vocabulary-repair/final-review/validation.json`,
`dictionary-audit.json`, `progress.json`, the two applied batch reports and browser
screenshots under `.cache/final-review-browser-results/`.
