# Free spelling and dictionary-matching repair

> Execute inline with executing-plans and verification-before-completion. The user
> explicitly approved this follow-up after the 1,209-word review finished. No
> subagents, additional worktree, paid requests, commit, push or deployment.

**Goal:** Assess all 456 withheld words for repairable headword, phrase or
dictionary-matching issues; publish only individually verified appropriate meanings.

**Architecture:** Keep the current runtime, schema and source wording. Pin a new
456-record baseline under `.cache/vocabulary-repair/matching-repair/`, protecting
all earlier public and core records. Tracked explicit decisions go under
`content/vocabulary/matching-review-batches/`. Reuse the existing editorial,
limited-release, source/cache and artifact helpers. Preserve the previous review
as historical evidence rather than changing its decisions retroactively.

**Sources:** Cached English Wiktionary, installed Princeton WordNet, and bounded
free OEWN/Wiktionary requests only. A source's explicit inflection or spelling
pointer may be joined to an individually reviewed base sense. Keep both original
texts and their attributions; do not invent a paraphrase or reuse unrelated examples.
Candidate generation never authorizes publication. Source errors, unclear mappings,
identity collisions and irrelevant specialist topics remain hidden.

## Constraints

- Preserve 12,115 IDs, all 5,981 core records, prior public records and their claim
  state, original source prose/examples, official memberships and connection status.
- Preserve six archives. Correct display/forms only through attributable editorial
  receipts and the existing historical-normalization/collision safeguards.
- Keep selected meaning-only examples empty, claims enabled and practice disabled.
- No paid calls, secrets, LLM clients, subscriptions or spend-ledger changes.
- Free network: sequential >=1.1s spacing, 25s timeout, 2MiB response, <=250MiB new
  retained cache; stop network after three consecutive failures. Reuse caches first.
- Lock before writes or source collection. No duplicate workers. All 456 get an
  explicit final disposition; completion does not require publishing every word.

## Tasks

- [x] Pin the current hidden cohort, all protected hashes and spend hash. Inspect
  every withholding reason and identify source-backed repair candidates.
- [x] Inspect cached form/spelling pointers and local WordNet headwords. Preview
  candidate mappings; test a small free-source pilot before further requests.
- [x] Read exact meanings, POS, labels, source identity and relevance. Author small
  explicit batches; record source indices/IDs and unchanged before-hashes.
- [x] Validate each batch before applying under lock with backup. Reapply and require
  zero changes. No collision merging, inferred membership or relationship promotion.
- [x] Rebuild with `node --import tsx scripts/build-word-data.ts`,
  `node --import tsx scripts/build-graph-data.ts` and
  `node --import tsx scripts/build-galaxy-assets.ts`. Verify every released profile
  and search entry; withheld words must remain absent.
- [x] Run `node --import tsx scripts/audit-dictionary.ts --strict`,
  `node --import tsx scripts/lint-vocabulary.ts`,
  `npm test -- --maxWorkers=1 --testTimeout=15000`, `npm run lint`,
  `npm run build` and the existing local desktop/mobile limited-example browser
  checks. Verify global release idempotence and `git diff --check`.
- [x] Reconcile all 456 decisions, exact release/hold/identity-change totals,
  protected hashes, source preservation, unchanged spending and cache size. Update
  documentation and leave changes local. No automatic further enrichment.

## Reviewed result

All **456** pinned IDs have final decisions in eight tracked batches:
**130 released / 326 withheld / zero pending**. Matching candidates were reviewed
individually (185 records); the other 271 retain their previously reviewed negative
decisions because no source-backed spelling/form repair was identified.

- 36 released records have corrected display headwords. No stable ID was changed,
  no duplicates were merged, and no official list membership was invented.
- Explicit Wiktionary form/variant relations are paired with exact reviewed
  WordNet or Wiktionary base senses. Both source texts and references are retained.
  Alternative forms explicitly listed in base-entry morphology also qualify;
  punctuation changes without that evidence remain withheld.
- One hierarchical Wiktionary definition (`maternal aunt`) was reconstructed from
  its shared parent and both child definitions, without paraphrasing or dropping
  the second half of “including both.” Both source references are retained.
- All 130 new selected senses are meaning-only: claimable, no example-dependent
  practice. No existing or suggested connections were promoted. They appear in
  All words; the five official per-list graphs retain their previous node totals.
- Current canonical/search totals: **12,115 IDs, 11,789 public, 326 hidden advanced**.
  Six archives and all 5,981 core records are unchanged. The 115 unclaimable core
  words are outside this advanced matching pass.
- `.cache/vocabulary-repair/matching-repair/validation.json` verifies all 130
  generated learning profiles and search entries, every protected record hash,
  withheld-record hashes, original sense prose/examples, forms, memberships,
  connection statuses and stable IDs.
- 90 free uncached source lookups were recorded, with no failures or paid calls.
  Retained shared free-source cache: 749,178 bytes (below the 250 MiB ceiling).
  Spending ledger SHA-256 remains
  `dc724adaaefc3784c93ca88bfd563eee8d6537a8e1e984563ada8939f85b13a2`.

Local-only delivery: no commit, push, database write or Vercel deployment.

## Validation

- All eight batch dry-runs report zero remaining changes. The global release
  manifest reports 937 approved records / zero changes / 326 withheld.
- `audit-dictionary.ts --strict`: zero strict blockers; 15,528 published
  connection records unchanged. `lint-vocabulary.ts`: zero errors or warnings.
- Vitest: 91 files, 644 tests passed. ESLint: zero errors, the same four inherited
  unused-variable warnings. Production build and its TypeScript phase passed.
- Offline historical-cohort assessment: 1,263 assessed, 937 public / 326 hidden,
  six archived, zero requests/writes; 3,988 usage items across 739 records, 176
  currently hidden, 51 records with free-text usage notes.
- First browser run: 11/12 passed. An existing desktop `absorbedly` test timed out
  while waiting for the animated drawer bounding box to fit the viewport; all six
  new spelling/form/hierarchy tests passed on desktop and mobile. The clean rerun
  passed **12/12**, including the unchanged failing test. No assertion was weakened
  or application code changed to hide the initial failure; the transient timing
  failure is retained here rather than omitted from the record.
- Visually inspected the 390px reconstructed-phrase drawer: complete definition,
  attribution and claim control fit without overlap. The new browser regressions
  cover plural/base expansion, accented display with stable claim ID, and the
  reconstructed hierarchical definition at 1280px and 390px.
- Final `git diff --check` passed. No worker lock remains. All eight batches and
  the global release are idempotent. The previous review's completed checkpoints
  remain historical; this matching-pass baseline supersedes its 456 withholding
  decisions without rewriting the previous review batches.

**Completed locally on 2026-10-16.** The remaining 326 are final withheld
decisions, not a pending worker queue. New evidence, a separately approved identity
merge/normalization, or a genuinely appropriate teaching context would be needed
to reopen them; no further automatic enrichment is running.
