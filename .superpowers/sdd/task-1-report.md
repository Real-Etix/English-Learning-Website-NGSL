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


---

# Task 1 Review-Finding Fixes

## Scope

Fixed only the two reviewer findings in the pure learner-profile transform and its focused regression tests. No API, UI, wiki-page, graph-asset, or public-type changes were made.

## RED

### Verified LLM-only advanced page

Added `does not verify an advanced LLM-only page from status and a wiki example alone` before changing production code. The fixture uses `tier: "advanced"`, `status: "verified"`, `sources: ["llm"]`, a wiki definition, and a wiki example.

Command: `npx vitest run lib/content/word-learning.test.ts`

Output before the fix:

```text
Tests  1 failed | 10 passed (11)
Expected: evidence "ai-draft", canClaim false
Received: evidence "verified", canClaim true
```

Root cause: status-based verification did not account for the absence of a factual source on advanced pages, so the wiki example also satisfied claim readiness.

### Empty and placeholder live dictionary senses

After the first regression was green, added `excludes empty and placeholder dictionary senses from an advanced AI draft` before the second production change. The fixture supplies an empty definition and `Definition pending — needs review.` dictionary definition, both with examples, to an advanced verified LLM-only page.

Command: `npx vitest run lib/content/word-learning.test.ts`

Output before the fix:

```text
Tests  1 failed | 11 passed (12)
Expected: evidence "ai-draft", canClaim false
Received: evidence "source-backed", canClaim true
```

Root cause: dictionary definitions were only checked for non-empty normalized text. Placeholder senses therefore became dictionary evidence, displayed senses, displayed examples, and claim evidence.

## GREEN

### Focused profile suite

Command: `npx vitest run lib/content/word-learning.test.ts`

Output after each corresponding minimal fix:

```text
Test Files  1 passed (1)
Tests  11 passed (11)
```

and then:

```text
Test Files  1 passed (1)
Tests  12 passed (12)
```

### Focused Task 1 verification

Command: `npx vitest run lib/content/word-learning.test.ts lib/wiki/parse-wiki.test.ts`

Output:

```text
Test Files  2 passed (2)
Tests  21 passed (21)
```

### Full verification

Commands: `npx tsc --noEmit`, `npm test`, `npm run lint`, and `git diff --check`.

Results:

- TypeScript passed with no output.
- Full Vitest suite: **21 files passed, 160 tests passed**.
- ESLint completed with no errors and the same two pre-existing warnings in `lib/galaxy/build-artifacts.ts` for `_xyz` and `_asset` unused parameters.
- `git diff --check` passed.

## Implementation

- Advanced pages without any factual source (`curated`, `wordnet`, `dictionaryapi`, or `tatoeba`) cannot gain `verified` evidence from their status alone. They remain AI drafts unless a usable live dictionary sense replaces their primary displayed sense.
- Reused `isPlaceholder` when filtering live dictionary senses. Empty and placeholder definitions are excluded before evidence selection, sense display, example display, and claim gating.
- Existing public types and authored strings are unchanged.

## Files changed

- `lib/content/word-learning.ts`
- `lib/content/word-learning.test.ts`
- `.superpowers/sdd/task-1-report.md`

## Concerns

- The Vite configuration warning about native config loading appears on every Vitest command and is unrelated to this fix.
- The two ESLint unused-parameter warnings are pre-existing and outside the allowed scope.
- Existing untracked Dictionary v2 plan/spec files remain untouched and are excluded from the fix commit.
