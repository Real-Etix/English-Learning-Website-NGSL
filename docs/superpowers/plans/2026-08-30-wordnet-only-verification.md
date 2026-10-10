# DictionaryAPI-Outage Vocabulary Verification Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add safe verifier profiles that can make progress during DictionaryAPI.dev outages.

**Architecture:** Extend the existing CLI configuration with pinned source modes. The recommended profile skips only DictionaryAPI while retaining WordNet, Tatoeba, and grounded DeepSeek decisions; the deterministic fallback uses WordNet alone. Disabled adapters are inert while the batch verifier's provider-failure behavior remains unchanged.

**Tech Stack:** TypeScript, Zod, Vitest, WordPOS, NDJSON verification pipeline.

## Global Constraints

- DictionaryAPI-disabled mode never calls DictionaryAPI.dev and still uses Tatoeba and the configured LLM judges.
- DeepSeek verifier calls use non-thinking JSON mode and stop after one supported reciprocal anchor.
- WordNet-only mode never calls DictionaryAPI.dev, Tatoeba, or an LLM.
- Full live mode retains its existing fail-closed behavior.
- Dry-run is required before write mode.
- No canonical vocabulary write is part of this implementation session.

---

### Task 1: CLI contract and pinned identity

**Files:**
- Modify: `scripts/verify-advanced-vocabulary.ts`
- Test: `scripts/verify-advanced-vocabulary.test.ts`

**Interfaces:**
- Consumes: `parseVerificationArgs(argv)` and the active-batch identity.
- Produces: `VerificationCliOptions.wordnetOnly: boolean` and a mode-aware identity/cache namespace.

- [ ] Add parser tests for the default, `--wordnet-only`, duplicate use, and fixture conflict.
- [ ] Run the focused tests and confirm they fail for the missing option.
- [ ] Add the option, identity field, and cache namespace.
- [ ] Run the focused tests and confirm they pass.

### Task 2: Deterministic dependency policy

**Files:**
- Modify: `scripts/verify-advanced-vocabulary.ts`
- Test: `scripts/verify-advanced-vocabulary.test.ts`

**Interfaces:**
- Consumes: `VerificationCliOptions.wordnetOnly`.
- Produces: dependency injection that returns `null`/`[]` for disabled sources and `null` judges.

- [ ] Add an integration test whose disabled adapters throw if called and whose WordNet evidence is publishable.
- [ ] Run the focused test and confirm the disabled adapter is called before implementation.
- [ ] Route WordNet-only runs through inert DictionaryAPI/Tatoeba/model adapters.
- [ ] Treat `judge_unavailable` as expected only in WordNet-only mode while retaining provider/budget blockers.
- [ ] Run the focused test and full verifier test files.

### Task 3: Bounded production dry-run

**Files:**
- No canonical source files modified.
- Output: `.cache/vocabulary-verification/wordnet-only/` and a JSON report.

**Interfaces:**
- Consumes: the new CLI mode and offline WordNet database.
- Produces: a no-write report and, only if infrastructure is healthy, a pinned batch.

- [ ] Run 25 deterministic candidates with zero external-request and token budgets.
- [ ] Run a bounded DictionaryAPI-disabled batch with Tatoeba and DeepSeek enabled.
- [ ] Inspect published, ambiguous, failed, and remaining-hidden counts.
- [ ] Run TypeScript, lint, and full Vitest verification.
