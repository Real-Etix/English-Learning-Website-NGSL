# Task 2 Report: Streaming NDJSON Repository and Atomic Shard Writer

## Status

Complete. Task 2 implements the streaming repository and deterministic atomic shard writer described in `.superpowers/sdd/task-2-brief.md`.

## TDD evidence

### RED

Tests were written first in `lib/vocabulary/ndjson-repository.test.ts` for:

- single-record lookup, streaming all records, and list filtering;
- sorted, newline-terminated writes and idempotent second writes;
- duplicate update rejection.

The first focused run was initially blocked by the sandbox when Vitest tried to create its temporary SSR directory. The same command was rerun with temporary-directory permission and failed for the intended reason:

```text
Error: Cannot find module './ndjson-repository' imported from .../lib/vocabulary/ndjson-repository.test.ts
```

This confirmed the tests failed because the requested production module did not yet exist.

### GREEN

After implementing the repository and writer:

```text
npx vitest run lib/vocabulary/ndjson-repository.test.ts
Test Files  1 passed (1)
Tests       3 passed (3)
```

The existing Vite configuration warning about CommonJS/ESM `vitest.config.ts` remains non-blocking.

Static verification:

```text
npx tsc --noEmit
exit code 0

git diff --check
exit code 0
```

## Changed files

- `lib/vocabulary/repository.ts`
  - Defines `VocabularyRepository` with `get`, `all`, and `list`.
- `lib/vocabulary/ndjson-repository.ts`
  - Reads only the calculated shard for `get`.
  - Streams `all` and `list` through async generators over the 32 shard IDs.
  - Caches each shard read as a promise per repository instance.
  - Validates every non-empty line with `VocabularyRecordSchema`.
  - Includes source filename and line number in decode errors.
  - Writes affected shards sorted by canonical lemma with one trailing newline.
  - Skips byte-identical writes.
  - Uses same-directory PID temporary files and rename-based atomic replacement.
  - Rejects duplicate update lemmas.
- `lib/vocabulary/ndjson-repository.test.ts`
  - Covers the repository, sorting/newline/idempotency behavior, and duplicate updates using temporary directories.

## Scope checks

- No Markdown files or Markdown parser behavior changed.
- No migration scripts were added or run.
- No PostgreSQL schema or data changed.
- No application routes or existing app behavior changed.
- The two unrelated untracked foundation documents were preserved.
- No push was performed.

## Concerns

- The repository currently treats a missing shard file as an empty shard, which is intentional for sparse repositories.
- The existing Vite configuration warning is still present.
- The full project test suite was not required by the Task 2 brief; focused tests and TypeScript verification passed.

## Review-fix report

### Scope

This fix addresses only the Task 2 review findings. No production repository behavior, Markdown files, later-task files, or PostgreSQL code was changed.

### Changes

- Awaited the asynchronous reread assertion in the atomic-write test.
- Corrected the fixture so `study` and `run` are both written to their calculated shared shard (`0c`), preserving unsorted input only within that real multi-record shard. The previous duplicate cross-shard `zebra` fixture is gone.
- Added a malformed-JSON test asserting the shard path and line number are included in the error.
- Added a schema-invalid-record test asserting the shard path and line number are included in the error.
- Added a duplicate-update test assertion that no temporary files remain.
- Added a `get()` isolation test proving an invalid unrelated shard is not read.
- No failed-write/rename injection was added because the current writer exposes no filesystem seam, and introducing one would exceed the requested small compatible change. The existing `finally` cleanup path remains unchanged.

### TDD and verification

The first focused Vitest invocation was blocked before collection by the environment’s Vitest SSR temp-directory permission (`EPERM`). Rerunning the same command with the required temporary-directory permission completed successfully; the existing implementation already satisfied the newly added behavioral assertions, so no production change was necessary.

```text
npx vitest run lib/vocabulary/ndjson-repository.test.ts
Test Files  1 passed (1)
Tests       6 passed (6)

npx tsc --noEmit
exit code 0

git diff --check
exit code 0
```

The existing Vite CommonJS/ESM configuration warning remains non-blocking. No push was performed.
