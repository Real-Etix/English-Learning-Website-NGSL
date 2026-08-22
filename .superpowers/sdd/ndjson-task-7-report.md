# Task 7: Canonical NDJSON enrichment report

Commit: `af086e95` (`refactor: enrich canonical vocabulary shards`)

## Delivered

- Added a pure `applyVocabularyProposals(records, proposals)` safety gate. It only
  adds existing-record connections with an `llm` source marker, non-blank gloss,
  supported edge type, and `unreviewed` status. It returns changed records and
  structured rejections without writing files.
- Made repeated source/target/type proposals idempotent and rejected unknown
  source lemmas/targets. Definition proposals are not applied; verified
  definitions are explicitly rejected.
- Added `npm run enrich:vocabulary -- --list=<slug> --limit=<n> [--dry-run]`.
  It selects canonical records, applies only validated existing-target links, and
  reports unknown suggestions to `wiki/raw/unresolved.json` outside dry-run.
- Ported `enrich-links.ts` to canonical records and `writeVocabularyRecords`.
  It no longer reads or writes `wiki/pages`.
- Ported `ingest-clips.ts` to archive the unchanged raw clip format and report
  unknown canonical candidates to `wiki/raw/unresolved.json`; it creates zero
  advanced records during this migration.

## Verification

- RED: `npx vitest run lib/vocabulary/enrichment/apply-proposals.test.ts` failed
  because `./apply-proposals` did not exist.
- GREEN: the focused test passed twice, 5/5 each time; the second application
  assertion reports zero changed records.
- `env LLM_API_KEY= MOONSHOT_API_KEY= npm run enrich:vocabulary -- --list=ngsl --limit=3 --dry-run`
  exited 0, printed selected lemmas plus unavailable/proposed/rejected counts,
  and wrote no files.
- `npx tsc --noEmit` completed successfully.
- `npm run lint:vocabulary` completed with 0 errors and 0 warnings.
- `npm run audit:dictionary` completed read-only.
- `git diff --check` completed successfully before commit.

## Concerns

- The audit continues to report pre-existing dictionary coverage and unexplained
  connection metrics; this task did not alter canonical content.
- Vitest emits an existing Vite configuration deprecation warning, but all
  focused tests pass.
- The two unrelated dictionary-v2 foundation documents remain untracked and were
  not included in the commit.

## Task 7 review fix

- Preserved every non-empty normalized enrichment target as a proposal even when
  its gloss is blank in both `enrich-vocabulary.ts` and `enrich-links.ts`.
  Empty normalized targets remain ignored.
- The pure gate therefore reports `unknown target: ...` before `blank gloss`,
  allowing the existing unresolved extraction to record unknown suggestions;
  existing targets with blank gloss are still rejected.
- Added a focused regression test for an unknown target with a blank gloss.

## Fix verification

- RED: the focused regression failed (1 failed, 5 passed) when the gate was
  temporarily ordered to reject blank gloss before unknown targets.
- GREEN: `npx vitest run lib/vocabulary/enrichment/apply-proposals.test.ts`
  passed twice after restoring the correct gate order, 6/6 each time.
- `npx tsc --noEmit` completed successfully.
- `git diff --check` completed successfully.

## Fix concerns

- Vitest emits the existing Vite configuration deprecation warning.
- The two unrelated dictionary-v2 foundation documents remain untracked and
  were preserved outside this fix.
