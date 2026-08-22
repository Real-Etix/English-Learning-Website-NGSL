# Vocabulary v2 Task 5 Follow-up

## Reviewer fixes

- `toLegacyPage` now accepts the known vocabulary records and uses
  `publicConnections`, so the legacy word payload applies the same published,
  glossed, known-public-target gate as every other learner-facing path. The word
  route passes the opened record plus all loaded connection targets.
- `toGraphInput` now requires `options.records`; it cannot silently interpret an
  omitted corpus as no known targets. All production and test callers pass their
  complete known-record set. The explicitly named
  `includeLegacyUnreviewedForClustering` option remains default-off.
- Regression coverage now exercises selector behavior through
  `buildWordLearningProfile` and `composableConnections` before compose task
  selection, as well as through the legacy adapter and a cross-record graph edge.

## Verification

Run after the fixes:

```text
npx vitest run lib/vocabulary/public-connections.test.ts lib/vocabulary/legacy-profile-adapter.test.ts lib/content/word-learning.test.ts lib/compose/tasks.test.ts lib/vocabulary/graph.test.ts lib/wiki/dictionary-quality.test.ts
# 6 files passed, 43 tests passed

npx tsc --noEmit
# passed
```

`npm run lint:vocabulary` reports `9214 error(s), 0 warning(s)`: existing corpus
debt under the Task 5 rule for published links that target non-public or missing
words.
