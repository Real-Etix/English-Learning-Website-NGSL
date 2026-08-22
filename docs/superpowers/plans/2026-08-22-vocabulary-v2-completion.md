# Vocabulary v2 Completion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Complete the sense-level vocabulary model, quarantine unsupported advanced drafts, require sourced claim evidence and explained public connections, enrich lists in SFI order, and ground learning features in a selected sense.

**Architecture:** This plan starts only after the Canonical NDJSON Vocabulary Pipeline is complete. Canonical records are enriched on reviewed GitHub branches; factual source imports and LLM-authored guidance remain distinct. Generated public artifacts include only published words, senses, examples, and explained connections.

**Tech Stack:** TypeScript 5, Zod 4.3, Vitest 4, Next.js 16.2 App Router, existing Free Dictionary/WordNet/Tatoeba adapters, existing OpenAI-compatible LLM client, GitHub Actions, generated galaxy assets.

## Global Constraints

- Do not resume enrichment until Task 1 hides unsupported advanced drafts and blocks unsupported creation.
- Never treat `llm` as factual evidence.
- Preserve source wording and authored connection glosses verbatim.
- Never label Free Dictionary API content as Cambridge Dictionary content.
- Never fabricate missing definitions, examples, usage guidance, mistakes, sources, or relationships at request time.
- A newly claimed word requires an explicitly selected published sense with factual evidence and a sourced example.
- Every learner-facing connection requires `status: "published"` and a non-empty gloss.
- Process content in this order: NGSL descending SFI, Academic, Business, TOEIC, Fitness, then hidden advanced drafts.
- Public requests must use generated content; no request may call the LLM for dictionary facts.
- Verified content is never automatically overwritten.
- Every enrichment batch has a hard item limit and model-token budget.
- Commit after every task and do not push unless the user explicitly authorizes it.

---

### Task 1: Publication Rules and Advanced-draft Quarantine

**Files:**
- Create: `lib/vocabulary/publication.ts`
- Create: `lib/vocabulary/publication.test.ts`
- Create: `scripts/quarantine-advanced-drafts.ts`
- Create: `scripts/quarantine-advanced-drafts.test.ts`
- Modify: `lib/vocabulary/schema.ts`
- Modify: `lib/vocabulary/graph-input.ts`
- Modify: `scripts/build-word-data.ts`
- Modify: `scripts/build-graph-data.ts`
- Modify: `package.json`

**Interfaces:**
- Produces: `factualEvidenceFor(record, sense): "verified" | "source-backed" | "ai-draft"`.
- Produces: `isSensePublishable(record, sense): boolean`.
- Produces: `isWordPublic(record): boolean`.
- Produces CLI: `npm run quarantine:advanced -- [--write]`.

- [ ] **Step 1: Write publication RED tests**

```ts
it("hides an LLM-only advanced record", () => {
  const record = vocabularyRecordFixture({
    tier: "advanced",
    status: "enriched",
    publicationStatus: "published",
    sources: [sourceRef("llm")],
    senses: [senseFixture({ sources: [sourceRef("llm")] })],
  });
  expect(publicationStatusFor(record)).toBe("hidden");
});

it("keeps a source-backed core record public", () => {
  expect(publicationStatusFor(vocabularyRecordFixture())).toBe("published");
});
```

Add artifact-filter tests proving hidden words are absent from list graphs, search
catalogs, chart shards, and full-galaxy output.

- [ ] **Step 2: Run focused tests and confirm RED**

Run: `npx vitest run lib/vocabulary/publication.test.ts scripts/quarantine-advanced-drafts.test.ts lib/galaxy/build-artifacts.test.ts`

Expected: FAIL because publication helpers and quarantine script do not exist and graph input still includes hidden records.

- [ ] **Step 3: Implement factual/publication rules**

Use the source registry's factual flag. `verified` requires the record or sense review status to be verified/published plus non-placeholder content. `source-backed` requires at least one factual source. `llm` alone always produces `ai-draft`.

An advanced record is public only when it has one publishable sense with a sourced
example and one published, glossed `builds_on` connection to a public core record.

- [ ] **Step 4: Implement quarantine dry-run and write modes**

Dry-run prints exact global/per-list counts and lemmas without changing shards.
`--write` updates only records whose calculated publication state differs and writes
through the atomic shard writer. It must be idempotent.

Add:

```json
"quarantine:advanced": "tsx scripts/quarantine-advanced-drafts.ts"
```

- [ ] **Step 5: Run quarantine and verify the exact corpus count**

Run: `npm run quarantine:advanced`

Expected: reports the current exact LLM-only advanced count (previous audit: 6,133)
without changing files.

Run: `npm run quarantine:advanced -- --write`

Run the same write command again.

Expected: first run changes the expected records; second run reports zero changes.

- [ ] **Step 6: Regenerate artifacts and commit**

Run: `npm run lint:vocabulary`

Run: `npm run build:graphs`

```bash
git add lib/vocabulary/publication.ts lib/vocabulary/publication.test.ts scripts/quarantine-advanced-drafts.ts scripts/quarantine-advanced-drafts.test.ts lib/vocabulary/schema.ts lib/vocabulary/graph-input.ts scripts/build-word-data.ts scripts/build-graph-data.ts content/vocabulary data/generated public/generated package.json
git commit -m "feat: quarantine unsupported advanced vocabulary"
```

---

### Task 2: Deterministic Sense Identity and Factual Source Import

**Files:**
- Create: `lib/vocabulary/sense-id.ts`
- Create: `lib/vocabulary/sense-id.test.ts`
- Create: `lib/vocabulary/source-evidence.ts`
- Create: `lib/vocabulary/source-evidence.test.ts`
- Create: `lib/vocabulary/enrichment/dictionary-import.ts`
- Create: `lib/vocabulary/enrichment/dictionary-import.test.ts`
- Modify: `lib/content/word-detail.ts`
- Modify: `content/vocabulary/sources.json`

**Interfaces:**
- Produces: `senseIdFor(input: { lemma; sourceId; externalId; partOfSpeech; definition }): string`.
- Produces: `importDictionaryDetail(record, detail, source): DictionaryImportResult`.
- Produces deterministic source/evidence helpers shared by profile, audit, and publication code.

- [ ] **Step 1: Write sense/import RED tests**

Assert the same source sense always receives the same ID, whitespace/case normalization
does not duplicate it, different external source IDs remain separate, and a repeated
dictionary import produces zero changes.

```ts
expect(senseIdFor(input)).toBe(senseIdFor({ ...input, definition: ` ${input.definition} ` }));
expect(importDictionaryDetail(record, detail, source).record.senses).toHaveLength(2);
expect(importDictionaryDetail(first.record, detail, source).changed).toBe(false);
```

- [ ] **Step 2: Run focused tests and confirm RED**

Run: `npx vitest run lib/vocabulary/sense-id.test.ts lib/vocabulary/source-evidence.test.ts lib/vocabulary/enrichment/dictionary-import.test.ts`

Expected: FAIL because the modules do not exist.

- [ ] **Step 3: Implement deterministic IDs and source precedence**

Hash normalized lemma, source ID, external ID, POS, and normalized definition. Keep the
full source definition text unchanged in storage. Source precedence is `verified
curated > factual imported > existing LLM draft`; lower evidence may add a separate
sense but may not overwrite stronger content.

- [ ] **Step 4: Expand dictionary detail transport**

Add optional source entry/sense IDs and pronunciation source metadata to `WordDetail`.
Keep remote failure returning an explicit empty detail. Do not change the public word
route yet; the enrichment worker consumes these fields first.

- [ ] **Step 5: Register factual providers**

Add `curated`, `wordnet`, `dictionaryapi`, and `tatoeba` with factual eligibility and
license notes. Add `llm` with `factual: false`. Validation must reject unknown IDs.

- [ ] **Step 6: Verify and commit**

Run: `npx vitest run lib/vocabulary/sense-id.test.ts lib/vocabulary/source-evidence.test.ts lib/vocabulary/enrichment/dictionary-import.test.ts lib/content/word-learning.test.ts`

Run: `npx tsc --noEmit`

```bash
git add lib/vocabulary/sense-id.ts lib/vocabulary/sense-id.test.ts lib/vocabulary/source-evidence.ts lib/vocabulary/source-evidence.test.ts lib/vocabulary/enrichment/dictionary-import.ts lib/vocabulary/enrichment/dictionary-import.test.ts lib/content/word-detail.ts content/vocabulary/sources.json
git commit -m "feat: import source-backed vocabulary senses"
```

---

### Task 3: Usage Patterns, Collocation Phrases, Mistakes, and Attribution UI

**Files:**
- Modify: `lib/vocabulary/schema.ts`
- Modify: `lib/content/word-learning.ts`
- Modify: `lib/content/word-learning.test.ts`
- Modify: `components/network/word-learning-drawer-model.ts`
- Modify: `components/network/word-learning-drawer-model.test.ts`
- Modify: `components/network/word-learning-drawer.tsx`
- Modify: `components/network/word-learning-drawer.test.tsx`
- Modify: `components/network/word-learning-response.ts`
- Modify: `components/network/word-learning-response.test.ts`

**Interfaces:**
- Extends `WordLearningProfile` with selected-sense-ready `usagePatterns`, `collocations`, and `commonMistakes`.
- Produces drawer sections that always show source/evidence labels and honest empty states.

- [ ] **Step 1: Write profile/model RED tests**

Create one published sense containing:

```ts
usagePatterns: [{
  pattern: "obtain + noun", explanation: "Used with something acquired formally.",
  examples: [sourcedExample("They obtained permission.")],
  sources: [sourceRef("curated")], status: "published",
}],
collocations: [{
  phrase: "obtain permission", explanation: "a common formal combination",
  sources: [sourceRef("curated")], status: "published",
}],
commonMistakes: [{
  incorrect: "obtain to permission", correction: "obtain permission",
  explanation: "Obtain takes a direct object here.",
  sources: [sourceRef("curated")], status: "published",
}],
```

Assert drafts are excluded, authored text remains unchanged, and the drawer model
groups all three sections under Use.

- [ ] **Step 2: Run tests and confirm RED**

Run: `npx vitest run lib/content/word-learning.test.ts components/network/word-learning-drawer-model.test.ts components/network/word-learning-drawer.test.tsx`

Expected: FAIL because the profile and drawer do not expose the new fields.

- [ ] **Step 3: Extend the normalized learning profile**

Include only selected/published sense guidance in learner-facing arrays. Preserve
source references and map them to explicit source labels. Keep existing examples,
forms, pronunciation, evidence, and connections compatible.

- [ ] **Step 4: Render accessible Use sections**

Inside the existing stable Use tab, render headings `Patterns`, `Common phrases`, and
`Watch out`. Each item includes source attribution. Empty sections use specific copy:

- `No reviewed usage patterns yet.`
- `No reviewed collocation phrases yet.`
- `No reviewed common mistakes yet.`

Do not render draft content behind a disclosure; drafts are editorial data only.

- [ ] **Step 5: Verify accessibility and compatibility**

Run: `npx vitest run lib/content/word-learning.test.ts components/network/word-learning-drawer-model.test.ts components/network/word-learning-drawer.test.tsx components/network/word-learning-response.test.ts`

Run: `npx tsc --noEmit`

Expected: all pass; existing Meaning/Use/Connect tab keyboard tests remain green.

- [ ] **Step 6: Commit**

```bash
git add lib/vocabulary/schema.ts lib/content/word-learning.ts lib/content/word-learning.test.ts components/network/word-learning-drawer-model.ts components/network/word-learning-drawer-model.test.ts components/network/word-learning-drawer.tsx components/network/word-learning-drawer.test.tsx components/network/word-learning-response.ts components/network/word-learning-response.test.ts
git commit -m "feat: teach vocabulary usage and mistakes"
```

---

### Task 4: Selected-sense Claim Readiness and Server Enforcement

**Files:**
- Create: `lib/vocabulary/claim-readiness.ts`
- Create: `lib/vocabulary/claim-readiness.test.ts`
- Modify: `lib/content/word-learning.ts`
- Modify: `components/network/word-learning-drawer.tsx`
- Modify: `components/network/star-atlas.tsx`
- Modify: `app/api/collect/route.ts`
- Create: `app/api/collect/route.test.ts`
- Modify: `lib/collection/service.ts`

**Interfaces:**
- Produces: `claimReadiness(record, senseId): { canClaim: boolean; reason: string | null }`.
- Changes collect request to `{ lemma: string; senseId: string }`.
- Server rejects hidden words, mismatched senses, unsupported senses, and senses without sourced examples.

- [ ] **Step 1: Write claim RED tests**

Cover published factual+sourced success and failures for missing sense, wrong lemma,
draft sense, AI-only sense, missing example, hidden word, and placeholder definition.

```ts
expect(claimReadiness(record, "bank:wordnet:1")).toEqual({ canClaim: true, reason: null });
expect(claimReadiness(recordWithoutExample, "bank:wordnet:1").reason)
  .toBe("This meaning needs a sourced example before it can be claimed.");
```

Route tests must prove a client cannot bypass the drawer by posting only a lemma.

- [ ] **Step 2: Run tests and confirm RED**

Run: `npx vitest run lib/vocabulary/claim-readiness.test.ts app/api/collect/route.test.ts`

Expected: FAIL because claim readiness and `senseId` enforcement do not exist.

- [ ] **Step 3: Implement pure readiness logic**

Use publication/evidence helpers from Tasks 1–2. Match sense IDs exactly after
validating the lemma. Require one example whose source registry entry is factual or
whose content was explicitly verified.

- [ ] **Step 4: Carry selected sense through UI and quiz state**

Add `selectedSenseId` to the drawer state. Selecting an additional meaning updates it.
Quiz prompts and examples come from that sense. `doClaim` posts both lemma and sense ID.
Keep the existing optimistic update only after the local profile says the sense is
claimable; roll it back on any non-2xx response.

- [ ] **Step 5: Enforce readiness in the route before collection mutation**

Load the generated canonical word, call `claimReadiness`, and return 409 with the exact
reason when blocked. Only then call `collectWord`. Existing held words are returned as
already collected without deleting history.

- [ ] **Step 6: Verify and commit**

Run: `npx vitest run lib/vocabulary/claim-readiness.test.ts app/api/collect/route.test.ts components/network/word-learning-drawer.test.tsx`

Run: `npx tsc --noEmit`

```bash
git add lib/vocabulary/claim-readiness.ts lib/vocabulary/claim-readiness.test.ts lib/content/word-learning.ts components/network/word-learning-drawer.tsx components/network/star-atlas.tsx app/api/collect/route.ts app/api/collect/route.test.ts lib/collection/service.ts
git commit -m "feat: require sourced sense before claiming"
```

---

### Task 5: Published Connection Gloss Gate

**Files:**
- Create: `lib/vocabulary/public-connections.ts`
- Create: `lib/vocabulary/public-connections.test.ts`
- Modify: `lib/vocabulary/graph-input.ts`
- Modify: `lib/content/word-learning.ts`
- Modify: `lib/compose/tasks.ts`
- Modify: `lib/content/tutor-context.ts`
- Modify: `lib/wiki/dictionary-quality.ts`
- Modify: `lib/wiki/dictionary-quality.test.ts`
- Modify: `scripts/lint-vocabulary.ts`

**Interfaces:**
- Produces: `publicConnections(record): VocabularyConnection[]`.
- Public connections require known target, `status: "published"`, and `gloss.trim().length > 0`.
- Clustering may consume legacy unreviewed edges only through an explicitly named migration option that defaults off after this task.

- [ ] **Step 1: Write connection RED tests**

Assert published+glossed survives; published+blank, unreviewed+glossed, hidden, unknown
target, and hidden-target connections are excluded. Assert compose and tutor receive
only the surviving connection.

- [ ] **Step 2: Run tests and confirm RED**

Run: `npx vitest run lib/vocabulary/public-connections.test.ts lib/compose/tasks.test.ts lib/content/tutor-context.test.ts lib/wiki/dictionary-quality.test.ts`

Expected: FAIL because graph/profile consumers still accept unreviewed connections.

- [ ] **Step 3: Implement one public-connection selector**

All learner-facing consumers must call the shared selector. Do not duplicate gloss
checks in routes or components. Keep authored gloss bytes unchanged.

- [ ] **Step 4: Strengthen lint and strict audit**

Lint errors when a `published` connection has no gloss or targets a non-public word.
Audit reports published/unreviewed/hidden and explained/unexplained counts by type.
Strict mode fails for any learner-facing connection without a gloss, not for hidden or
unreviewed editorial debt.

- [ ] **Step 5: Regenerate and verify**

Run: `npm run lint:vocabulary`

Run: `npm run audit:dictionary -- --strict`

Expected: strict may still fail for remaining published debt; record the exact count
and do not weaken the rule.

Run: `npm run build:graphs`

Run focused tests and typecheck.

- [ ] **Step 6: Commit**

```bash
git add lib/vocabulary/public-connections.ts lib/vocabulary/public-connections.test.ts lib/vocabulary/graph-input.ts lib/content/word-learning.ts lib/compose/tasks.ts lib/content/tutor-context.ts lib/wiki/dictionary-quality.ts lib/wiki/dictionary-quality.test.ts scripts/lint-vocabulary.ts data/generated public/generated
git commit -m "feat: require glossed public vocabulary links"
```

---

### Task 6: Ordered Enrichment Selection, Budgets, and Idempotent Batches

**Files:**
- Create: `lib/vocabulary/enrichment/select-batch.ts`
- Create: `lib/vocabulary/enrichment/select-batch.test.ts`
- Create: `lib/vocabulary/enrichment/budget.ts`
- Create: `lib/vocabulary/enrichment/budget.test.ts`
- Modify: `scripts/llm-client.ts`
- Modify: `scripts/enrich-vocabulary.ts`

**Interfaces:**
- Produces: `selectEnrichmentBatch(records, options): VocabularyRecord[]`.
- Produces: `TokenBudget` with `reserve`, `recordActual`, `remaining`, and `exhausted`.
- CLI accepts `--stage`, `--limit`, `--max-input-tokens`, `--max-output-tokens`, `--dry-run`.

- [ ] **Step 1: Write exact ordering RED tests**

Use overlapping list fixtures and assert order:

```ts
expect(selectEnrichmentBatch(records, { limit: 7 }).map((word) => word.lemma)).toEqual([
  "ngsl-high-sfi", "ngsl-low-sfi", "academic-only", "business-only",
  "toeic-only", "fitness-only", "advanced-supported",
]);
```

Assert a word in NGSL and Academic appears once at NGSL priority, ties use rank then
lemma, satisfied records are skipped, and hidden advanced words come last.

- [ ] **Step 2: Write token-budget RED tests**

Assert a reservation that would exceed either ceiling is rejected before an API call,
actual usage reduces remaining values, and retries cannot double-charge one request ID.

- [ ] **Step 3: Run tests and confirm RED**

Run: `npx vitest run lib/vocabulary/enrichment/select-batch.test.ts lib/vocabulary/enrichment/budget.test.ts`

Expected: FAIL because selection and budget modules do not exist.

- [ ] **Step 4: Implement deterministic selection**

Priority is NGSL descending SFI/null last then rank/lemma; other named lists use
rank/null last then lemma; advanced uses published-core-anchor count descending then
lemma. Deduplicate by normalized lemma before slicing to limit.

- [ ] **Step 5: Return LLM token usage**

Extend the LLM client with a result shape:

```ts
type LlmResult<T> = {
  value: T;
  usage: { inputTokens: number; outputTokens: number };
  requestId: string;
};
```

Keep existing `completeChat`/`completeJSON` compatibility wrappers. When a provider
omits usage, charge the reserved estimate rather than zero.

- [ ] **Step 6: Integrate selection and budgets into dry-run output**

Dry-run prints ordered lemmas, reasons, and estimated tokens without calling any API.
Live mode stops before exceeding either budget and exits 0 with a clear `budget
exhausted` summary so the pull request can contain the completed safe subset.

- [ ] **Step 7: Verify and commit**

Run: `npx vitest run lib/vocabulary/enrichment/select-batch.test.ts lib/vocabulary/enrichment/budget.test.ts`

Run: `npm run enrich:vocabulary -- --stage=ngsl --limit=10 --max-input-tokens=10000 --max-output-tokens=5000 --dry-run`

```bash
git add lib/vocabulary/enrichment/select-batch.ts lib/vocabulary/enrichment/select-batch.test.ts lib/vocabulary/enrichment/budget.ts lib/vocabulary/enrichment/budget.test.ts scripts/llm-client.ts scripts/enrich-vocabulary.ts
git commit -m "feat: order and budget vocabulary enrichment"
```

---

### Task 7: Source-backed Enrichment Proposals and Advanced Revalidation

**Files:**
- Create: `lib/vocabulary/enrichment/proposal-schema.ts`
- Create: `lib/vocabulary/enrichment/proposal-schema.test.ts`
- Create: `lib/vocabulary/enrichment/enrich-record.ts`
- Create: `lib/vocabulary/enrichment/enrich-record.test.ts`
- Modify: `scripts/enrich-vocabulary.ts`
- Modify: `.github/workflows/vocabulary-enrichment.yml`
- Modify: `scripts/verify-enrichment-diff.ts`

**Interfaces:**
- Produces: `VocabularyEnrichmentProposalSchema`.
- Produces: `enrichRecord(record, factualDetail, llmProposal): EnrichmentDecision`.
- New advanced records require factual sense, sourced example, and explained core anchor before `review`.

- [ ] **Step 1: Write proposal-validation RED tests**

Assert rejection of fabricated source IDs, blank glosses, unknown targets, unsupported
advanced creation, duplicate senses, example-free publication, and LLM attempts to
replace verified definitions. Assert a valid usage-pattern proposal remains `review`,
not automatically `published`.

- [ ] **Step 2: Run tests and confirm RED**

Run: `npx vitest run lib/vocabulary/enrichment/proposal-schema.test.ts lib/vocabulary/enrichment/enrich-record.test.ts`

Expected: FAIL because proposal schema and decision engine do not exist.

- [ ] **Step 3: Implement factual import before LLM guidance**

For each selected word, import dictionary senses/examples first. Give the LLM only the
record, imported factual content, known public connection targets, and requested
guidance schema. LLM output may propose explanations, patterns, mistakes, and glosses;
it may not assert source IDs or publication state.

- [ ] **Step 4: Implement advanced revalidation**

Existing hidden advanced records can move to `review` after factual sense+example
import and a glossed core anchor. They move to `published` only through explicit
approval metadata in the pull request change. Unknown advanced suggestions go to the
enrichment report and do not create records.

- [ ] **Step 5: Strengthen workflow inputs and reports**

Add stage and token-budget inputs. Upload a JSON enrichment report as a workflow
artifact and include counts for factual imports, review proposals, hidden records,
rejections, token use, and estimated remaining debt in the pull-request body. Never
include prompts, API keys, or complete provider responses.

- [ ] **Step 6: Verify fixture live-path behavior without paid calls**

Use injected dictionary/LLM fixtures in tests. Run workflow commands locally with
`--fixture=tests/fixtures/enrichment-source-backed.json`; expect deterministic shard,
manifest, audit, and graph diffs.

- [ ] **Step 7: Commit**

```bash
git add lib/vocabulary/enrichment/proposal-schema.ts lib/vocabulary/enrichment/proposal-schema.test.ts lib/vocabulary/enrichment/enrich-record.ts lib/vocabulary/enrichment/enrich-record.test.ts scripts/enrich-vocabulary.ts .github/workflows/vocabulary-enrichment.yml scripts/verify-enrichment-diff.ts
git commit -m "feat: validate vocabulary enrichment proposals"
```

---

### Task 8: Selected-sense Tutor and Composition Grounding

**Files:**
- Modify: `lib/content/tutor-context.ts`
- Modify: `lib/content/tutor-context.test.ts`
- Modify: `app/api/chat/route.ts`
- Create: `app/api/chat/route.test.ts`
- Modify: `lib/compose/tasks.ts`
- Modify: `lib/compose/tasks.test.ts`
- Modify: `app/api/compose/route.ts`
- Create: `app/api/compose/route.test.ts`
- Modify: `components/network/star-atlas.tsx`

**Interfaces:**
- Chat request becomes `{ messages, listSlug?, lemma?, senseId? }`.
- Compose task request becomes `{ action: "task", lemma, senseId, claimed?, avoid? }`.
- Produces: `buildTutorSenseContext(record, senseId): string | null`.

- [ ] **Step 1: Write selected-sense context RED tests**

Create a word with two published senses and assert context includes only the selected
definition, examples, patterns, mistakes, collocations, and relevant published
connections. Assert it excludes the other sense, drafts, hidden connections, and
unglossed links. A mismatched sense ID returns `null`.

- [ ] **Step 2: Write route RED tests**

Assert chat/compose reject a supplied sense ID that does not belong to the lemma,
reject hidden senses, and preserve rate limiting/history truncation. Compose partner
definitions must come from selected published senses for both words.

- [ ] **Step 3: Run tests and confirm RED**

Run: `npx vitest run lib/content/tutor-context.test.ts app/api/chat/route.test.ts lib/compose/tasks.test.ts app/api/compose/route.test.ts`

Expected: FAIL because routes still ground by lemma/profile primary meaning.

- [ ] **Step 4: Implement bounded selected-sense context**

Include at most three examples, six guidance items, and twelve explained connections.
End with the existing anti-fabrication instruction. Never fall back to another sense
when an explicit sense ID is invalid.

- [ ] **Step 5: Carry sense IDs from the drawer**

Chat suggestions, tutor submissions, and composition requests use the drawer's current
selected sense. When no sense was explicitly selected, send the profile's published
primary sense ID for backward-compatible UX.

- [ ] **Step 6: Verify and commit**

Run: `npx vitest run lib/content/tutor-context.test.ts app/api/chat/route.test.ts lib/compose/tasks.test.ts app/api/compose/route.test.ts`

Run: `npx tsc --noEmit`

```bash
git add lib/content/tutor-context.ts lib/content/tutor-context.test.ts app/api/chat/route.ts app/api/chat/route.test.ts lib/compose/tasks.ts lib/compose/tasks.test.ts app/api/compose/route.ts app/api/compose/route.test.ts components/network/star-atlas.tsx
git commit -m "feat: ground learning in selected vocabulary senses"
```

---

### Task 9: Expanded Quality Audit and Vocabulary v2 Release Gate

**Files:**
- Modify: `lib/wiki/dictionary-quality.ts`
- Modify: `lib/wiki/dictionary-quality.test.ts`
- Modify: `scripts/audit-dictionary.ts`
- Modify: `README.md`
- Modify: `wiki/CLAUDE.md`
- Modify: `.github/workflows/vocabulary-enrichment.yml`

**Interfaces:**
- Audit reports publication, sense evidence/examples, patterns, mistakes, connections,
  advanced quarantine, claim readiness, and source-provider coverage globally/per list.
- Strict mode fails only blocking published-content violations.

- [ ] **Step 1: Write expanded audit RED tests**

Use fixtures covering every publication state and source provider. Assert global and
per-list counts for:

```ts
{
  publication: { draft, review, published, hidden },
  senses: { total, unsupported, withoutExamples },
  usage: { withoutPatterns, withoutMistakes },
  connections: { published, unreviewed, hidden, unexplained },
  advanced: { quarantined, reviewable, published },
  claimableSenses,
  sources: { curated, wordnet, dictionaryapi, tatoeba, llm },
}
```

Assert duplicate list IDs count once and reserved keys remain safe.

- [ ] **Step 2: Run audit test and confirm RED**

Run: `npx vitest run lib/wiki/dictionary-quality.test.ts`

Expected: FAIL because the report lacks Vocabulary v2 metrics.

- [ ] **Step 3: Implement expanded deterministic audit**

Keep prototype-free dynamic records and stable sorted output. Strict failure conditions
are: published placeholder, published unsupported sense, claimable sense without a
sourced example, published hidden target, or learner-facing connection without gloss.
Missing optional patterns/mistakes and hidden drafts remain non-blocking debt.

- [ ] **Step 4: Add CI merge gate**

The enrichment workflow runs strict audit after applying proposals. It may open a pull
request containing non-blocking debt, but it must not push a branch whose changed
records introduce a new strict violation. Compare strict violation counts against the
base manifest and fail on regression even while legacy blocking debt is being reduced.

- [ ] **Step 5: Run final complete verification**

Run: `npm test`

Run: `npx tsc --noEmit`

Run: `npm run lint`

Run: `npm run lint:vocabulary`

Run: `npm run audit:dictionary`

Run: `npm run audit:dictionary -- --strict`

Run: `npm run build:graphs`

Run: `npm run build`

Run: `git diff --check`

Expected: tests/typecheck/lint/build pass. Strict audit exits 0 only when all published
blocking violations are resolved; otherwise the release remains blocked and the exact
remaining categories are reported rather than weakened.

- [ ] **Step 6: Document the operating model and commit**

Document source hierarchy, publication states, selected-sense claims, public
connection rules, enrichment ordering, token budgets, GitHub review flow, audit
interpretation, and the fact that hidden drafts are excluded from public star counts.

```bash
git add lib/wiki/dictionary-quality.ts lib/wiki/dictionary-quality.test.ts scripts/audit-dictionary.ts README.md wiki/CLAUDE.md .github/workflows/vocabulary-enrichment.yml
git commit -m "docs: complete vocabulary v2 operating contract"
```
