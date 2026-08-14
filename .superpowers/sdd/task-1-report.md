# Task 1 — Wiki Metadata and Learner Profile

## Scope

Implemented only the Task 1 parser metadata and pure learner-profile transformation. No API routes, React UI, wiki pages, generated graph assets, or remote Git were changed.

## RED

### Parser metadata

Command:

```sh
npx vitest run lib/wiki/parse-wiki.test.ts
```

Output (before implementation):

```text
FAIL  lib/wiki/parse-wiki.test.ts > parsePage > parses frontmatter fields
AssertionError: expected undefined to deeply equal [ 'wordnet', 'llm' ]
Test Files  1 failed (1)
Tests  1 failed | 8 passed (9)
```

The failure was caused by `WikiPage` not exposing `sources` or `usageNote`.

### Learner profile

Command:

```sh
npx vitest run lib/content/word-learning.test.ts
```

Output (before implementation):

```text
FAIL  lib/content/word-learning.test.ts
Error: Cannot find module './word-learning'
Test Files  1 failed (1)
Tests  no tests
```

The failure was caused by the required pure profile-builder module being absent.

## GREEN

Command:

```sh
npx vitest run lib/content/word-learning.test.ts lib/wiki/parse-wiki.test.ts
```

Output:

```text
Test Files  2 passed (2)
Tests  19 passed (19)
```

## Implementation

- Added `sources: string[]` and optional `usageNote: string | null` parsing to `WikiPage`.
- Added the serializable `LearningEvidence`, `LearningSense`, `LearningExample`, `LearningConnection`, and `WordLearningProfile` types.
- Added pure `buildWordLearningProfile(page, detail)` with no network or filesystem access.
- Applied source precedence, LLM-only advanced-page dictionary rescue, definition/example deduplication, six-sense cap, pronunciation copying, verbatim connection gloss preservation, `explained` metadata, and claim readiness gating.

## Files changed

- `lib/wiki/parse-wiki.ts`
- `lib/wiki/parse-wiki.test.ts`
- `lib/content/word-learning.ts`
- `lib/content/word-learning.test.ts`
- `.superpowers/sdd/task-1-report.md`

## Full-suite verification

Commands:

```sh
npx tsc --noEmit
npm test
npm run lint
```

Results:

- TypeScript: passed with no output.
- Full Vitest suite: **21 files passed, 158 tests passed**.
- ESLint: passed with no errors; it reports two pre-existing warnings in `lib/galaxy/build-artifacts.ts` for `_xyz` and `_asset` unused parameters.
- `git diff --check`: passed.

## Self-review

- Confirmed parser defaults: absent `sources` becomes `[]`; absent `## Usage note` becomes `null`.
- Confirmed displayed definitions, example strings, and connection glosses are not rewritten; normalization is used only for deduplication.
- Confirmed a source-backed/verified word cannot become claimable without an example.
- Confirmed an LLM-only advanced draft cannot become claimable without dictionary-backed meaning and example evidence.
- Confirmed the profile does not read files, call the network, mutate inputs, or alter graph data.
- Confirmed only Task 1 source/test/report files are staged for the commit; the two existing untracked Dictionary v2 design documents are excluded.

## Concerns

- This is foundational only. The API, drawer, tutor, composition flow, and quality audit still consume the older raw word data until their later tasks are implemented.
- Existing corpus provenance is page-level, not example-level. The profile conservatively counts wiki examples toward claim readiness only when the page definition is verified or backed by a factual source; dictionary examples are always sourced.
- The Vite configuration warning is unrelated to Task 1 and appears on every Vitest run.
