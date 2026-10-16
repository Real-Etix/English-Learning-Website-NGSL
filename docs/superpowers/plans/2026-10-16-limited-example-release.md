# Limited-example release implementation plan

> Execute sequentially in the existing approved checkout; no subagents. Follow the approved spec in `../specs/2026-10-16-limited-example-release.md`.

**Goal:** Publish individually reviewed factual meanings, enable meaning claims, and keep example-dependent practice unavailable where evidence is missing.

**Architecture:** Optional sense-level content-bound review receipt; shared publication/claim/practice predicates; explicit offline manifest applied to NDJSON with hash checks. Reuse existing Next.js/React UI and generated-artifact pipeline.

- [x] 1. Write failing tests for reviewed-meaning publication, claims, stale receipts, archives and AI-only sources. Add schema and browser-safe content snapshot validation; preserve legacy gates.
- [x] 2. Test and implement definition-only quizzes, limitation display, tutor grounding, and server-side practice restrictions. Read bundled Next.js route guidance before API changes.
- [x] 3. Test and implement an offline, hash-pinned, idempotent release applicator. Inspect imported factual candidates; explicitly approve appropriate senses and retain uncertain content hidden.
- [x] 4. Apply the reviewed manifest; regenerate schema, word data and graphs. Verify exact counts, core/source preservation, archive exclusion and unchanged spending ledger.
- [x] 5. Run full tests, TypeScript, lint, strict dictionary audit and build. Review the diff and document outcomes. Leave changes local, uncommitted and undeployed.

## Results

- Reviewed the 30 non-archived candidates imported in the preceding free-source pass. Released 26 exact senses: 25 without examples, plus `per annum` with two OEWN examples. The four explicit withholds are in `content/vocabulary/limited-example-release.json`; this does not approve the entire hidden backlog.
- Corpus: 12,115 records, 10,878 public, 1,237 hidden advanced. All 5,981 official core record lines are byte-identical to HEAD; 115 core words remain unclaimable. Six archived specialists stay hidden. All pre-release sense text, source references and connections for the 26 releases were compared against the saved backup and are unchanged.
- Repeat `--write` and dry-run both report zero changes. New releases are in the generated All-words search catalog/Drift, not automatically inserted into official lists. No relationships were promoted.
- Full suite: **635 tests / 91 files pass**. Sandbox-only CLI tests initially failed on `tsx` IPC permission; rerunning with local process permission resolved that. The final run used `--maxWorkers=1 --testTimeout=15000` because two existing CLI startup tests exceeded their original five-second timeout under machine load. No assertions were removed.
- Production build (including TypeScript), standalone TypeScript check, vocabulary lint, strict dictionary audit and `git diff --check` pass. ESLint has zero errors and four inherited unused-variable warnings. Strict audit reports 25 approved limited-example exceptions and zero blocking violations.
- Two Playwright flows pass in installed Chrome at 1280px and 390px, with all service APIs mocked: find word, read attributed meaning, answer meaning quiz, claim exact sense, confirm sentence practice remains disabled. Browser screenshots were visually inspected.
- Visual inspection caught an existing narrow-header overflow that allowed focus to scroll the entire observatory sideways, clipping the drawer by about 238px. Added a compact two-row mobile header, a shared header-height variable, and non-scrollable outer clipping; desktop layout is unchanged. Browser tests now assert the drawer stays inside the viewport.
- Browser fixtures needed an onboarding initialization fix and a quiz-option selector correction; the final flows pass. Used installed Chrome rather than downloading Playwright's missing bundled browser.
- Spending ledger SHA-256 remains `dc724adaaefc3784c93ca88bfd563eee8d6537a8e1e984563ada8939f85b13a2`. No paid calls, new source downloads, database writes, subagents, commit, push, or Vercel deployment.

## Follow-up boundary

Further hidden words still need individual source/scope review before being added to a new pinned release. Connections, usage patterns, and examples require their own reviews; this release does not invent them or silently approve old model proposals. Updating a reviewed sense's content/source/scope invalidates its receipt until reviewed again.

## Follow-up release from newly extracted usage evidence

The user explicitly authorized another free-only review and release. Reuse the
existing publication and claim behavior. Review discovered that the learner
profile/drawer and tutor omitted canonical sense labels; a small tested fix must
carry and display them so restrictions such as `of liquids` reach the learner.
Work inline in the existing checkout, preserving earlier uncommitted changes.

- [x] Review all 49 then-hidden words with newly extracted free-text usage
  qualifiers. Read their full candidate meanings, usage restrictions, examples
  and original learning anchors; record an explicit decision for each.
- [x] Select only attributable, self-contained meanings with an appropriate
  learning scope. Retain exact source prose and relevant raw usage restrictions
  as labels. Leave ambiguous identity, unsupported register, unrelated specialist
  senses and unclear definitions hidden; do not approve old graph relationships.
- [x] Append selected factual candidates through `applyFreeAssessmentReview`,
  using hash-bound editorial decisions. Add exact source IDs to the existing
  limited-example manifest and run `release-limited-examples.ts` dry-run first.
- [x] Apply the release with the existing locked, backed-up writer. Reapply to
  prove idempotence. Verify preserved core records, previous releases, sources,
  connections, and the unchanged spending ledger.
- [x] Observe failing profile, drawer and tutor tests for missing sense labels;
  then carry exact labels into each visible sense and render them as wrapped,
  non-interactive text. Keep hidden-sense qualifiers out and escape source markup.
- [x] Regenerate word/graph/galaxy assets; run full tests, TypeScript, lint, strict
  dictionary audit and production build. Check each new word in generated output
  and verify meaning claims and practice restrictions. Report exact counts.
- [x] Keep all changes local; no paid calls, subscriptions, subagents, push or
  deployment. Record remaining gaps honestly rather than claiming whole-corpus
  review.

### Follow-up results

- Reviewed 49 words from the usage-qualifier cohort: **28 released, 21 withheld**.
  Exact selected source IDs, appropriate learning scopes and individual reasons
  are recorded in `content/vocabulary/usage-evidence-review-2026-10-16.json`.
  This is not a review of the entire remaining hidden corpus.
- Selected source candidates are preserved in full, including any old example
  pairings. Separate `:meaning-review-20261016` sense versions carry the exact
  chosen definitions and usage labels, without examples. The unrelated medical
  claims previously attached to `androgen` and the phrase-only `bisque` example
  remain hidden. No connections or old model assertions were approved.
- Imported the hash-pinned decisions and applied the existing limited-example
  writer after dry-run validation. Reapplying reported **zero changes**. Preparation
  backups and comparison reports are under
  `.cache/vocabulary-repair/usage-evidence-release-2026-10-16/`; publication backups
  remain under `.cache/vocabulary-repair/limited-example-release-v1/`.
- Current corpus: **12,115 total, 10,906 public, 1,209 hidden advanced**. The two
  releases together approved 54 words, 53 without examples. All 5,981 core records,
  115 unclaimable core words, six archived specialists and earlier public records
  are unchanged. Preserved old sense text/source references and unchanged
  connections/forms/list memberships were checked against the backups.
- All 28 generated word profiles match their reviewed definitions, exact sense
  IDs and labels; each permits a meaning claim and blocks sentence practice. All
  are in the All-words search catalog, while the 21 withheld words remain absent.
  No official list memberships were invented. Published connection count remains
  15,528; the All-words graph has 10,906 nodes and 14,949 edges.
- The three missing-label regressions failed before the fix. The learner profile,
  drawer and tutor now retain exact per-sense labels, with hidden labels excluded
  and source text escaped. Focused tests passed, then the full suite passed:
  **644 tests / 91 files**, one worker with a 15-second test timeout.
- TypeScript, vocabulary lint, strict dictionary audit, `git diff --check` and the
  production build passed. ESLint reports zero errors and four inherited warnings.
  The first restricted production build failed inside Next's Google-font resolver;
  the unchanged build passed with network permission. No font, dependency or
  design workaround was introduced.
- **Six Playwright flows passed** using installed Chrome: `absorbedly`, `indebted`
  and `miscible`, each at 1280px and 390px. They verify search, meaning/source display,
  labels where present, in-bounds drawer layout, exact-sense meaning claims and
  disabled sentence practice. Desktop/mobile screenshots were visually inspected.
  All service APIs were mocked: no dictionary, model or database writes. Temporary
  browser output and one-off preparation helpers are explicitly Git-ignored.
- Offline assessment refresh made **zero source requests and zero paid calls**;
  applying editorial decisions again reported zero changes. The spending ledger
  still hashes to `dc724adaaefc3784c93ca88bfd563eee8d6537a8e1e984563ada8939f85b13a2`.
  No subscription, subagent, commit, push or deployment was performed.
