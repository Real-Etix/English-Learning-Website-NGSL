# Task 1 Implementation Report

## Status

Task 1 is complete. Canonical vocabulary schemas, stable SHA-256 sharding, and a deterministic source-backed fixture are implemented. Task 2 was not started, and the Markdown corpus was not modified.

## Commit

`6bdecdef` — `feat: define canonical vocabulary records`

Only the five Task 1 implementation/test files were committed. The two pre-existing unrelated untracked files under `docs/superpowers/` were preserved and left untouched.

## Changed files

- `lib/vocabulary/schema.ts`
  - Adds strict Zod schemas and inferred types for `VocabularyRecord`, `VocabularySense`, `VocabularyConnection`, `ContentSourceRef`, and `PublicationStatus`.
  - Validates bounded enum fields, normalized non-empty lemmas, finite ranks/SFI values, source references, sense definitions, and persisted object shapes.
- `lib/vocabulary/shards.ts`
  - Adds normalized lemma handling and stable low-five-bit SHA-256 shard IDs (`00` through `1f`).
- `lib/vocabulary/test-fixtures.ts`
  - Adds a fixed complete core record with a sourced sense, sourced example, and explained published connection.
- `lib/vocabulary/schema.test.ts`
  - Verifies the complete fixture is accepted and an invalid publication state is rejected.
- `lib/vocabulary/shards.test.ts`
  - Verifies normalization and the required stable shard vectors for `bank`, `get`, and `academic`.

## TDD and verification

1. RED command:

   `npx vitest run lib/vocabulary/schema.test.ts lib/vocabulary/shards.test.ts`

   Result: failed as expected after the test runner was given temporary-directory access. Both suites reported `Cannot find module` for the not-yet-created `./schema` and `./shards` modules.

2. GREEN command:

   `npx vitest run lib/vocabulary/schema.test.ts lib/vocabulary/shards.test.ts`

   Result: exit code 0; 2 test files passed and 2 tests passed.

3. TypeScript command:

   `npx tsc --noEmit`

   Result: exit code 0 with no TypeScript errors.

4. Staged-diff validation:

   `git diff --cached --check`

   Result: exit code 0; no whitespace errors.

## Concerns

- Vitest emits the existing Vite CommonJS/ESM configuration warning; it does not fail the focused tests.
- Cross-record validation such as duplicate lemmas, dangling connection targets, reciprocal edges, and complete-shard validation is intentionally deferred to later migration tasks.
- The report file itself is outside the five Task 1 files and was not included in the Task 1 implementation commit.

---

# Task 1 Review-Finding Fix Report

## Scope

Fixed only the two requested schema-review findings. Vocabulary record lemmas and connection targets now require canonical normalized form, and focused tests cover the requested invalid input boundaries. No later-task files or unrelated foundation documents were modified. No push was performed.

## RED

Added focused tests for non-normalized record lemmas and connection targets, invalid rank/SFI values, unknown nested keys, invalid source IDs/timestamps, and invalid connection types before changing the schema implementation.

Command:

```sh
npx vitest run lib/vocabulary/schema.test.ts lib/vocabulary/shards.test.ts
```

Result after allowing Vitest's required temporary-directory access:

```text
Test Files  2 passed (2)
Tests  7 passed (8)
1 failed: rejects non-normalized connection targets
AssertionError: expected true to be false
```

The failing test demonstrated that `VocabularyConnection.target` accepted `" Study "`.

The first sandboxed invocation also failed before running tests with:

```text
Error: EPERM: operation not permitted, mkdir .../ssr
```

This was environment access, not a test or code failure; the command was rerun with the required temporary-directory permission.

## Implementation

Added one private `normalizedLemma` validator based on the existing `normalizeVocabularyLemma()` function. Applied it to both `VocabularyRecordSchema.lemma` and `VocabularyConnectionSchema.target`, replacing the record-level refinement with the same field-level behavior. This rejects leading/trailing whitespace, uppercase characters, and uncollapsed internal whitespace while preserving the existing non-empty validation.

## GREEN

Focused tests:

```sh
npx vitest run lib/vocabulary/schema.test.ts lib/vocabulary/shards.test.ts
```

Result:

```text
Test Files  2 passed (2)
Tests  8 passed (8)
```

Typecheck:

```sh
npx tsc --noEmit
```

Result: exit code 0 with no TypeScript errors.

Diff validation:

```sh
git diff --check
```

Result: exit code 0 with no whitespace errors.

## Self-review

- The production change is limited to the shared normalized-lemma validator and its two schema fields.
- Tests are behavior-focused and cover every requested invalid-input category.
- No child-schema exports or shard constants were added because they were optional and unnecessary for these fixes.
- The existing Vite CommonJS/ESM warning remains unrelated and non-failing.

## Final canonical-whitespace fix

### Scope

Fixed only the remaining review finding: canonical record lemmas and connection targets must reject lowercase values with leading/trailing whitespace and values with uncollapsed internal whitespace. Other text fields continue using the existing trimmed `nonEmpty` validator, so this change does not alter authored definitions, examples, glosses, or other content fields. No later-task files or unrelated foundation documents were modified. No push was performed.

### RED

Added tests for:

- record lemmas `" learn"` and `"learn "`;
- record lemma `"learn  well"`;
- connection targets `" study"` and `"study "`;
- connection target `"study  well"`.

Command:

```sh
npx vitest run lib/vocabulary/schema.test.ts lib/vocabulary/shards.test.ts
```

Result: exit code 1 after Vitest was granted its required temporary-directory access. The two new leading/trailing-whitespace tests failed because the previous `normalizedLemma` validator used `z.string().trim()` before refinement; the internal-whitespace assertions and all existing assertions passed.

The initial sandboxed invocation stopped before loading tests with `EPERM` while creating Vitest's temporary `ssr` directory; this was environment access rather than a test failure.

### Minimal implementation

Changed only `normalizedLemma` in `lib/vocabulary/schema.ts` from the trimming `nonEmpty` schema to `z.string().min(1)` before the existing normalization refinement. Since `normalizeVocabularyLemma()` trims, lowercases, and collapses whitespace for comparison, any non-canonical original lemma or target now fails validation without rewriting the input. The `lemma` and `target` schema fields already shared this validator.

### GREEN and verification

Focused tests:

```sh
npx vitest run lib/vocabulary/schema.test.ts lib/vocabulary/shards.test.ts
```

Result: exit code 0; 2 test files passed and 12 tests passed.

Typecheck:

```sh
npx tsc --noEmit
```

Result: exit code 0 with no TypeScript errors.

Self-review:

```sh
git diff --check
```

Result: exit code 0 with no whitespace errors. The diff contains only the canonical validator, its boundary tests, and this report append. The existing Vite CommonJS/ESM warning remains unrelated and non-failing.
