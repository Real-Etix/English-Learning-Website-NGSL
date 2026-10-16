# Remaining 1,209 hidden words: free review plan

> Execute inline using executing-plans. No subagents or extra worktree. The user
> authorized continuing until this review is finished or they ask to stop.

**Goal:** Give every currently hidden advanced word an explicit evidence-based
decision; publish appropriate attributable meanings under the existing approved
limited-example policy, not by loosening the publication gate.

**Architecture:** Pin the starting cohort and source assessment in the ignored
`.cache/vocabulary-repair/remaining-free-review/` directory. Author small tracked
decision batches under `content/vocabulary/free-review-batches/`. Reuse the tested
editorial and limited-release applicators, hash checks, worker lock and backups.
Canonical NDJSON remains the source of truth. No runtime feature change is planned.

## Boundaries

- Free sources only; no API keys, LLM requests or change to spend.json.
- Preserve 12,115 IDs, all core records, earlier public releases, original source
  prose, examples and relationships. Six archived specialists remain hidden.
- Select exact source sense IDs, preserve usage restrictions, and explain the
  learning-list scope. No inferred synonyms, invented memberships or edge promotion.
- Limited examples are acceptable; do not attach unrelated source examples merely
  to unlock practice. Use explicit meaning-only sense versions where necessary.
- New public-source requests: sequential, >=1.1 seconds apart, 25-second timeout,
  <=2 MiB each, retained cache <=250 MiB. Stop network requests after three repeated
  failures, without treating an outage as evidence that a word is invalid.
- No commit, push or deployment. Existing uncommitted changes belong to the user.
- Use the existing heartbeat for checkpointed continuation, replacing its obsolete
  paid/deployment instructions. Never start duplicate workers. Stop on completion,
  user stop request, or when no safe meaningful work remains.

## Tasks

- [x] Pin all 1,209 IDs/current hashes, the latest source report, core/public hashes,
  archived IDs, and unchanged spending hash. Verify no live worker before writes.
- [x] Read candidate definitions, labels and learning anchors in bounded batches.
  Record one explicit decision for every word: exact chosen source sense and scope,
  or a concrete withholding reason. Existing archives/withholds are not automatic
  release candidates; their recorded reasons must be respected or explicitly resolved.
- [x] For remaining source gaps/unclear senses, try the already-tested free OEWN
  adapter with bounded requests. Use cached Wiktionary and Princeton WordNet first.
  A correction must preserve stable IDs and have exact source identity evidence.
- [x] Dry-run each authored batch against pinned record/source hashes. Preserve
  source candidates, append meaning-only reviewed versions, validate claim/practice
  predicates and unchanged links, then apply under the recovery lock with backups.
  Reapply each batch and require zero changes. Checkpoint after every batch.
- [x] Regenerate word, graph and galaxy artifacts after each completed release
  group. Verify released words in All-words search and withheld words absent.
- [x] At final completion run vocabulary lint, strict audit, full tests (one
  worker, 15-second timeout), TypeScript, ESLint, production build and existing
  desktop/mobile limited-release browser checks. Inspect screenshots if UI changes.
- [x] Reconcile exactly 1,209 final decisions, publication counts and preserved
  core/previous-public/source records. Report published/withheld reasons honestly;
  “review finished” does not mean every word is publishable. Pause the heartbeat.

## Commands and checkpoint contract

- Source assessment: `node --import tsx scripts/assess-free-vocabulary.ts` (offline).
- Reviewed publication: `node --import tsx scripts/release-limited-examples.ts`
  followed by `--write` only after preparation/preview passes.
- Artifacts: `node --import tsx scripts/build-word-data.ts`,
  `node --import tsx scripts/build-graph-data.ts`,
  `node --import tsx scripts/build-galaxy-assets.ts`.
- Tests: `npm test -- --maxWorkers=1 --testTimeout=15000`.
- Audit: `node --import tsx scripts/audit-dictionary.ts --strict`.
- Checkpoint files retain reviewed batch IDs, released/withheld IDs, source request
  counts, baseline hashes and concrete next work. Never silently advance a review
  cursor beyond words actually read. Pending words stay pending, not “unsupported”.

## Progress

Initial state: 10,906 public; 1,209 hidden advanced (including six archived);
115 unclaimable core unchanged. Cached Wiktionary candidates exist for 995 of the
hidden records; 214 lack an extracted candidate. These are evidence counts, not
publication decisions.

### Checkpoint after batches 001–008

- **299 reviewed: 167 released, 132 withheld, 910 still pending.** This is not
  whole-backlog completion. Canonical totals are 11,073 public and 1,042 hidden
  advanced (132 reviewed holds plus 910 pending). Core records/115 core claim gaps
  and the earlier public corpus remain unchanged.
- The exact-member free OEWN gap pass assessed all 214 words lacking cached
  Wiktionary candidates: 210 new requests, four cache hits, 43 words with candidates,
  zero provider failures. Only individually selected meanings were published.
- Local Princeton WordNet was queried offline across all four POS for 1,203
  non-archived candidates. It returned exact-member evidence for 707 words with
  zero network/model calls. Proper-name/homonym matches were explicitly rejected
  where inappropriate (e.g. Chambers the architect versus judges' chambers).
- Every batch passed dry-run, preservation checks, publication and a repeated
  write with zero changes. Released words have one selected, claimable meaning,
  exact source labels, no released examples and no promoted connections.
- All new generated word profiles/search entries were checked, all reviewed holds
  remain absent, and all protected record hashes match the pinned baseline.
  The unchanged spending hash is
  `dc724adaaefc3784c93ca88bfd563eee8d6537a8e1e984563ada8939f85b13a2`.
- Word/graph/galaxy artifacts rebuilt; official list node counts are unchanged.
  Strict dictionary audit has zero blockers; vocabulary lint has zero errors or
  warnings. The full 644-test / 91-file suite passes with one worker.
- Production build (including TypeScript) passes with network access for existing
  Google fonts. ESLint has zero errors and four inherited unused-variable warnings.
  The offline assessment refresh makes zero requests and reports zero additional
  reviewed changes; the global release manifest also dry-runs to zero changes.
- Selected Wiktionary candidates were additionally checked for omitted entry-wide
  restrictions: none of the released senses have an unretained entry label.
- Six installed-Chrome desktop/mobile flows passed against the production build
  with all service APIs mocked (no paid calls or database writes). `git diff --check`
  passes and the worker lock is released. The continuation heartbeat remains active.
- New retained source cache is about 940 KiB total (including the earlier pilot);
  ignored baseline/backups/reports/local WordNet review evidence occupy about
  10 MiB. No huge dump, paid calls, subagents, database writes, commit or deployment.

### Checkpoint after batches 001–020

- **779 reviewed: 474 released, 305 withheld, 430 pending.** Batches 009–020
  individually reviewed another 480 words, releasing 307 and withholding 173.
  This remains an ongoing review, not completion of the pinned cohort.
- Canonical totals: **11,380 public / 735 hidden advanced** (305 reviewed holds
  plus 430 pending). All 12,115 stable IDs, 5,981 core records, 115 core claim gaps,
  earlier public records, original source prose/examples and connection statuses
  remain unchanged. Six existing archives remain hidden.
- All 20 authored batches are applied. Every new batch passed a dry run and
  idempotent repeated write with zero changes. The global release manifest also
  dry-runs to zero changes across 528 approvals (54 earlier plus 474 backlog).
- Every released profile and search entry passes the content-bound integrity
  check: one selected claimable meaning, exact source definition and labels,
  no released examples, no sentence practice and no promoted connections.
  All reviewed holds remain absent from public search and byte-equivalent to
  their pinned records. All 359 selected Wiktionary senses were additionally
  checked for omitted entry-wide restrictions: none are missing.
- Word, graph and galaxy outputs were regenerated. All-words has 11,380 nodes;
  official list node counts and all 15,528 published connections are unchanged.
  The strict dictionary audit has zero blockers and vocabulary lint has zero
  errors/warnings. All 644 tests in 91 files pass with one worker. Production
  build and TypeScript pass; ESLint has zero errors and four inherited warnings.
- Six installed-Chrome desktop/mobile limited-release flows pass against the
  production build with all service APIs mocked: claims use the reviewed sense
  and sentence practice remains disabled. `git diff --check` passes. These are
  local checks, not verification of a deployed website.
- Offline assessment made zero requests and reports 528 public / 735 hidden
  in the historical 1,263-word cohort, with 375 hidden words retaining usage
  evidence. It proposes zero additional reviewed changes. No source lookups,
  paid calls, credentials, spending-ledger changes, commits or deployment in
  batches 009–020. Retained free-source cache remains about 940 KiB; review
  baselines/backups/reports occupy about 15 MiB.
- The heartbeat is confirmed ACTIVE at a 30-minute interval with the current
  free-only/local-only instructions. The recovery lock is released. Next batch
  is **021**, starting after **obligor**; use the pinned baseline rather than
  replacing it with the refreshed assessment report.

### Final completion: batches 001–031

- **All 1,209 reviewed: 753 released, 456 withheld, zero pending.** The final
  requested 430-word continuation (021–031) released **279** and withheld **151**.
  All 31 authored batches are applied, with 1,209 unique decisions and no missing
  reports. Each batch passed dry-run, write and repeated-write checks; repeat
  application changed zero records. Withholding is a completed editorial decision,
  not a claim that the word does not exist or can never be published.
- Selected sources across the backlog: **559 Wiktionary, 163 Princeton WordNet,
  31 Open English Wordnet** meanings. All 559 Wiktionary selections were checked
  for omitted entry-wide restrictions; none are missing. No source requests,
  paid/model calls or credentials were used during the final 430-word continuation.
- Canonical and rebuilt All-words search totals: **11,659 public / 456 hidden
  advanced**, including the six preserved archives. All **12,115 IDs**, **5,981
  core records**, **115 core claim gaps**, earlier public records, original source
  prose/examples, list memberships, forms and connection statuses are preserved.
  All **15,528 published connections** remain unchanged. Official list graph node
  counts remain NGSL 4,386; TOEIC 1,998; Business 2,901; Academic 1,546; Fitness 886.
- Every released profile was checked against its exact reviewed source sense,
  definition and labels. All new releases are discoverable in All words and
  meaning-claimable, with no released examples, no sentence practice and no
  promoted connections. Every withheld record remains hidden, absent from public
  search, and identical to its pinned record. Existing source errors were not
  copied into the selected senses (for example, the incorrect plant-respiration
  and carbon-monoxide alternatives for `respire`).
- The global limited-release manifest dry-runs to **807 approvals / zero changes**
  (54 earlier releases plus 753 backlog releases). The offline historical
  1,263-word assessment reports 807 public / 456 hidden, six archived, zero
  requests and zero further reviewed changes. It retains 3,988 usage items across
  739 words, including 189 currently hidden words and 51 with raw usage notes.
- Final verification: strict dictionary audit **zero blockers**; canonical lint
  **zero errors/warnings**; **644 tests in 91 files pass**; production build and
  TypeScript pass. ESLint has zero errors and four inherited unused-variable
  warnings. All **six installed-Chrome desktop/mobile browser checks** pass with
  service APIs mocked (no database writes or paid calls). `git diff --check` passes.
- Spending hash remains
  `dc724adaaefc3784c93ca88bfd563eee8d6537a8e1e984563ada8939f85b13a2`.
  Retained new free-source cache is about **940 KiB**, below the 250 MiB cap;
  ignored review evidence, baselines, backups and reports occupy about **23 MiB**.
- Work remains local and uncommitted on `cursor/ngsl-mood-trainer`; no push or
  deployment was performed. Generated stale content-addressed assets were replaced
  by the normal artifact builder; canonical source records were not deleted.
  The review heartbeat is paused after completion. Uncertain words, separately
  unreviewed relationships, and the unchanged 115 core claim gaps are not silently
  promoted; any follow-up is a new scoped task.

### Retained continuation procedure (completed; do not restart automatically)

1. Inspect `.cache/vocabulary-repair/worker.lock` and live processes. No paid repair
   script is needed. Read `remaining-free-review/progress.json` and `validation.json`.
2. The ignored mechanical runner is
   `.cache/vocabulary-repair/remaining-free-review/manage.ts`. Its `init` command
   has already pinned the original cohort; **do not run init again**.
3. `node --import tsx .cache/vocabulary-repair/remaining-free-review/manage.ts show 40`
   prints the next unreviewed words, every extracted definition, usage labels and
   old model anchor glosses. Glosses are context to scrutinize, not factual evidence.
   The completed queue now has zero pending words.
4. For an interrupted batch, inspect its tracked file under
   `content/vocabulary/free-review-batches/` (001–031). Use the same policy and an
   actual UTC review timestamp for any separately authorized future review.
   For a release choose `source: wiki|oewn|wordnet`, exact shown `sense` index,
   allowed `lists`, and a word-specific reason. For a hold use `hold: true` and an
   explicit reason. The runner records exact source IDs and before-hashes in the
   tracked batch; it never infers approval. Read every selected meaning before writing.
5. Run `manage.ts apply <batch>.json` without `--write`; inspect the preview, then run
   with `--write` and repeat. The runner reuses existing tested pure applicators,
   backs up canonical/manifests, preserves old source senses, appends meaning-only
   versions, validates all protected hashes, rejects duplicate word decisions, and
   keeps a checkpoint. The final global release script also dry-runs to zero changes.
6. If a turn was interrupted, compare authored batches against `applied-*.json`;
   finish/reapply any authored but unapplied batch before advancing. Do not count an
   authored file as applied. Do not rerun completed source collection.
7. Rebuild artifacts after a release group, then run
   `node --import tsx .cache/vocabulary-repair/remaining-free-review/verify.ts`.
   This checks every released artifact and held word, prior source preservation,
   unchanged connections/core/previous-public records, and unchanged spending.
8. Preserve uncertain words hidden; no blanket approval of circular definitions,
   spelling-only pointers, mismatched senses or unrelated specialists. If a held
   identity can be safely repaired later, that requires a separately reviewed exact
   source mapping, not duplicate batch decisions or a guessed rewrite.
9. The heartbeat is paused because the review is complete. Do not resume the
   completed queue or restore obsolete paid/push instructions. A follow-up requires
   a new user request with its own scope and approvals.
