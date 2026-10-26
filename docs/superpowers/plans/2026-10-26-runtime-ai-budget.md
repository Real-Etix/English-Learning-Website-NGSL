# Runtime AI Budget Implementation Plan

> **For agentic workers:** Use `executing-plans` inline, task-by-task. No subagents.

**Goal:** Bound runtime tutor/grader spending to the approved shared ¥1 daily allowance without changing offline enrichment or learning data.

**Architecture:** Validate bounded requests, reserve conservative integer micro-CNY in PostgreSQL, dispatch once, and settle idempotently. Fail closed for paid dispatch and retain explicitly labeled free grading.

**Tech Stack:** Next.js 16 Route Handlers, TypeScript, Prisma 7/PostgreSQL, Vitest; no new production dependencies.

## Global constraints

- Follow `../specs/2026-10-26-runtime-ai-budget-design.md` (user approved).
- Work in the existing project checkout. Preserve all vocabulary/generated content.
- No paid tests, production database writes, commits, pushes or deployment this pass.
- Shared allowance 1,000,000 micro-CNY/day, China midnight reset; visitor limits 3/minute and 20/day.
- 32 KiB bodies, 16 KiB conversation, 24 KiB complete prompts; outputs 800/300 tokens.
- Preserve uncertain reservations; no automatic provider retries.

## Task 1 — Policy, identity and input boundaries

**Files:** `lib/ai/policy.ts`, `lib/ai/input.ts`, corresponding `.test.ts` files.
**Interfaces:** `runtimePolicy(env, now)`, `budgetWindow(now)`, `reserveCost(messages, outputTokens)`, `visitorKey(request, secret)`, `readJsonObject(request)`, `parseChatInput(body)`, `parseComposeInput(body)`.

- [x] Write failing tests for off/missing/expired/unsupported configuration, China midnight, UTF-8 limits, missing/malformed content and byte-stream limits.
- [x] Run `npx vitest run lib/ai/policy.test.ts lib/ai/input.test.ts`; confirm new-module failures.
- [x] Implement pure policy and validation. Use `createHmac('sha256', secret)` for visitor identity, fixed rate policy with explicit expiry, integer arithmetic and bounded body streaming. Only Vercel's trusted client-IP header is accepted in production; local tests use a fixed local visitor.
- [x] Run the two test files to green. Review that no request or credential is logged.

Example expected arithmetic:

```ts
expect(reserveCost([{ role: 'user', content: 'Hi' }], 800))
  .toBe((2 + 256 + 1024) * 2 + 800 * 8);
```

## Task 2 — Atomic shared accounting

**Files:** `lib/ai/budget-store.ts`, `lib/ai/budget-store.test.ts`, `prisma/schema.prisma`, `prisma/runtime-ai-budget.sql`.
**Interfaces:** `BudgetStore.reserve({id, day, resetAt, visitor, minute, amount, cap})` and `BudgetStore.settle(id, actualCost)`; reservation returns accepted or a rate/budget refusal. SQL store accepts a Prisma transaction-capable client.

- [x] Write local PostgreSQL tests for simultaneous visitors competing for the last reservation, minute/day limits, repeated settlement, abandoned reservations, day rollover and usage anomalies. Integration tests require a deliberately supplied loopback-only `AI_TEST_DATABASE_URL`; otherwise explicitly skip.
- [x] Run the integration suite and observe failure before creating new tables/code.
- [x] Add three isolated models: daily counter, visitor windows, per-request reservations. Provide transaction-wrapped additive SQL for those tables only. Lock the daily row first for admission and settlement; conditionally update each reservation only once. A sticky accounting-anomaly flag blocks subsequent dispatch across days.
- [x] Run tests against an isolated temporary local schema. Drop only that schema in test cleanup. Never load the production URL for integration tests.

Concurrency invariant:

```ts
expect(accepted.reduce((sum, entry) => sum + entry.amount, 0)).toBeLessThanOrEqual(cap);
```

## Task 3 — Guarded runtime transport

**Files:** `lib/ai/runtime.ts`, `lib/ai/runtime.test.ts`.
**Interfaces:** `runtimeChat(request, messages, kind)` returns success text or a typed safe refusal (`budget`, `rate`, `unavailable`, `input`, `provider`). Dependency injection supplies store/fetch/clock for tests.

- [x] Write failing tests proving no network call on failed admission, one attempt on provider failure, explicit thinking/output limits, conservative settlement, retained reservations for absent/invalid usage, oversized responses and timeout, and no key/error leakage.
- [x] Run `npx vitest run lib/ai/runtime.test.ts` to confirm red.
- [x] Implement one bounded fetch using the approved endpoint/config, a 45-second signal covering body reads, and a 128 KiB response limit. Do not call or edit the offline enrichment client. Settle before returning success; on settlement failure return safe unavailability and leave reservation intact.
- [x] Run all `lib/ai` unit tests; inspect paid-dispatch call order.

## Task 4 — Route integration and transparent basic grading

**Files:** `app/api/chat/route.ts`, `app/api/compose/route.ts`, their tests; `components/network/star-atlas.tsx` only if the existing offline verdict label is insufficient.

- [x] Extend route tests for malformed input, prompt bounds and guard denial; update previous expectations that silently truncated excess history.
- [x] Observe failures, then replace runtime imports of the enrichment client with the guarded runtime module. Keep current sense/publication checks, in-memory cheap front-door limits, and sourced-example restrictions.
- [x] Rebuild grading tasks from canonical server records and the chosen published relation using `pickTask`; reject missing/mismatched partner relations. Never trust client definitions, glosses, required words or mode as provider instructions.
- [x] Return existing `verdict.source: 'offline'` for fallback and make its visible label say basic check; preserve AI source labeling for actual model verdicts.
- [x] Run route and compose/UI tests, then type-check. Confirm free task selection and claims do not depend on the AI guard.

## Task 5 — Full verification, live QA and activation guide

**Files:** `docs/runtime-ai-budget.md`; final verification record in this plan.

- [x] Finish read-only live checks for list switches, search, connection navigation, limited examples, full-galaxy warning, desktop and narrow layouts. Never submit a live paid call or write collection data.
- [x] Document kill switch, HMAC secret, pricing expiry, additive SQL activation, review procedure and rollback. Explicitly distinguish application accounting from the provider balance and other key users.
- [x] Run `npm test`, `npx tsc --noEmit`, `npm run lint`, `npm run build`. Record exit codes/counts and any pre-existing warnings.
- [x] Inline code review: admission concurrency, crash/timeout windows, retry count, server-only credential boundary, malformed request paths and no edits to enrichment data/ledger.
- [x] Report what passed, what remains untested in production, and that activation/deployment are not done. Leave local changes ready for user review.

## Plan review

All spec requirements map to Tasks 1–5; the same micro-CNY units and request IDs are used throughout. Local database testing is explicitly isolated and optional only when unavailable (a reported verification gap, never a silent pass). No production writes or paid calls are part of acceptance.

## Final verification — 2026-10-26

- All 5 tasks completed inline. No subagents, production changes, commits or pushes.
- `npm test -- --testTimeout=15000 --maxWorkers=1 --pool=threads`: **696 passed / 97 files**, including 5 PostgreSQL integration tests. Paid keys were explicitly blanked and runtime AI disabled for final verification. A disposable PostgreSQL 16 container used only loopback port 55433 and temporary schemas.
- Type-check: exit 0. Prisma schema validation: exit 0. ESLint: exit 0, 0 errors and 4 unchanged warnings. `git diff --check`: clean.
- Final production build: exit 0, all 18 static pages generated.
- Built-app localhost HTTP checks: NGSL page 200; AI disabled 503; invalid JSON object 400; oversized body 413; cross-site Origin 403; invalid grading input 400. No collections or provider requests were submitted by these smoke checks.
- Read-only live desktop and 390×844 checks are recorded in `docs/runtime-ai-budget.md`. One existing quiz issue remains: a definition can reveal its answer. No vocabulary edits were made in this pass.
- Old enrichment ledger SHA-256 remains `dc724adaaefc3784c93ca88bfd563eee8d6537a8e1e984563ada8939f85b13a2`.
- Early baseline/test runs encountered a sandbox IPC restriction and a worker-startup timeout; both were resolved with local execution permission, a CLI startup timeout and a single test worker. They were not reported as passing runs.
- Test-isolation incident: during a red test, the route still imported its old provider client after its mock was changed. The attempts failed with `fetch failed`; the run was stopped. Both legacy and new client paths were then mocked, and subsequent full runs explicitly blanked paid credentials. No successful provider response was observed; provider billing was not queried.
- Inline review added JSON/same-origin request checks, strict grader-verdict validation and a preview-deployment paid-call block. Database transactions use a short global advisory lock to coordinate admission and late settlement across midnight; no lock is held during a provider call.
- Existing checkout retained. New production activation instructions are in `docs/runtime-ai-budget.md`; activation/deployment needs the next user-approved step.

## Approved production activation follow-up — 2026-10-26

The user subsequently approved activation, commit/push and exact-commit deployment
verification. Vercel's existing production credentials are sensitive/write-only.
The user explicitly approved applying the additive SQL inside the next production
build, restricted to its exact commit, and restoring the normal build command.
No paid requests, secret extraction, new subscriptions or vocabulary edits.

- [x] Add `scripts/activate-runtime-ai-budget.ts` and its test. Export a pure
  `activationAllowed(env, expectedSha, now)` guard: skip non-Vercel/non-production
  and other commits; reject the wrong project/repository/branch, invalid runtime
  policy or a non-Neon database URL before connecting. Never load local `.env`.
- [x] Test the guard red then green with dummy credentials; reject malformed SHA,
  wrong host/schema, missing configuration and expired policy. Test SQL execution
  ordering, existing-learning-table preflight and metadata mismatch rollback via
  a transaction-bound database interface. Tests must not connect to production.
- [x] Implement application of only `prisma/runtime-ai-budget.sql` inside a bounded PostgreSQL
  transaction with `SET LOCAL search_path = public`, preflight `Collection` and
  `CollectedWord`, validate all 13 accounting columns, FK/index, and absence of an
  accounting anomaly before commit. Preserve all existing rows. Log only stage
  names and fixed verification markers; suppress raw database errors.
- [x] Run full tests, type/lint/build and inline review. Commit scoped files only.
- [ ] Add the four runtime configuration variables to production only; generate
  a fresh HMAC secret in memory and store as sensitive. Preserve existing provider
  and database values. Save the existing build command (`null`) in a secret-free
  ignored receipt before setting a one-off command gated to the exact new SHA.
- [ ] Push `cursor/ngsl-mood-trainer` without force. Verify Vercel build-log
  activation marker, READY state, exact Git SHA and production alias through its
  control-plane API. Restore `buildCommand: null` and verify that restoration.
- [ ] Report deployment/configuration evidence without claiming a paid smoke test.

Activation follow-up verification: 714 tests passed, 5 explicitly skipped local
PostgreSQL tests (the earlier disposable database is stopped); type-check and
production build exited 0; lint has the same 4 pre-existing warnings and no errors.
The 23 new activation checks first failed for the absent module, then passed. A
test fixture initially lacked Next's required `NODE_ENV` type; adding the explicit
dummy production environment fixed the type error. Inline review checked the
commit/project gates, SQL hash, public search path, bounded transaction, no secret
logging, no provider calls and preservation of existing rows. The integration
tests for the accounting SQL had passed against disposable PostgreSQL 16 in the
implementation pass; production setup will additionally verify real metadata
inside the migration transaction. This record does not yet assert deployment.
