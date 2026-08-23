# Source-Backed Automatic Advanced Vocabulary Verification Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a conservative local pipeline that automatically verifies hidden advanced vocabulary against factual sources, publishes only high-confidence records with sourced examples and supported reciprocal core links, and leaves uncertain records hidden.

**Architecture:** The command reads the canonical NDJSON snapshot, ranks hidden advanced candidates by learner-facing network value, gathers normalized WordNet/DictionaryAPI/Tatoeba evidence behind a resumable cache, and uses DeepSeek only to select from finite factual choices. A pure mutation engine calculates and validates the entire batch before the existing atomic shard writer persists it; generated graphs are rebuilt only after a changed write.

**Tech Stack:** TypeScript 5, Zod 4.3, Vitest 4, Node.js filesystem/crypto APIs, `wordpos` 2.1, DictionaryAPI.dev, Tatoeba, the existing OpenAI-compatible LLM client, canonical NDJSON shards, and existing graph builders.

## Global Constraints

- The 32 NDJSON shards under `content/vocabulary/` remain the only canonical vocabulary source.
- Run verification locally; do not add a Vercel runtime route or automatic GitHub merge.
- Dry-run is the default. Only `--write` may change canonical shards.
- Default batch size is 25; default concurrency is 3; reject concurrency above 5.
- Rank candidates by incoming published connection count descending, distinct published core anchors descending, then normalized lemma ascending.
- Query WordNet offline and require exact canonical part-of-speech matching.
- DictionaryAPI.dev and Tatoeba calls are bounded, retried at most twice, cached, and never place API keys in URLs.
- DeepSeek may choose only finite factual sense IDs or finite relationship outcomes supplied in the request.
- DeepSeek cannot create or rewrite definitions, examples, sources, statuses, lemmas, targets, or connection glosses.
- A published advanced record needs an exact-POS factual definition, at least one matching factual example, and at least one supported reciprocal `builds_on` / `advanced_form` core anchor.
- Tatoeba can satisfy the example gate only after a grounded decision matches the sentence to the selected factual sense.
- Preserve the exact stored bytes of both supported connection glosses.
- Unsupported or ambiguous reciprocal links become `unreviewed` in both directions; they are not deleted.
- Cache normalized provider evidence and model decisions under `.cache/vocabulary-verification/`, outside Git.
- Never write raw provider payloads, prompts, model replies, environment variables, or API credentials to reports or committed files.
- Calculate and schema-validate every changed record before the first canonical write.
- Run graph generation only after a successful changed `--write`.
- Tests use injected functions and fixtures; no automated test may call a live source or model.
- Commit after every task and do not push unless the user explicitly authorizes it.

## File Map

- `lib/vocabulary/verification/types.ts` — stable candidate, evidence, outcome, and reason-code contracts.
- `lib/vocabulary/verification/candidate-selector.ts` — deterministic candidate discovery and ranking.
- `lib/vocabulary/verification/provider-types.ts` — provider-neutral factual evidence contracts.
- `lib/vocabulary/verification/wordnet-provider.ts` — exact-POS offline WordNet normalization.
- `lib/vocabulary/verification/http-providers.ts` — bounded DictionaryAPI.dev and Tatoeba adapters.
- `lib/vocabulary/verification/cache.ts` — canonical hashing plus validated atomic cache reads/writes.
- `lib/vocabulary/verification/source-budget.ts` — retry-safe source-request budget.
- `lib/vocabulary/verification/decision-schema.ts` — strict finite model-response schemas.
- `lib/vocabulary/verification/sense-verifier.ts` — deterministic sense gates and grounded finite sense selection.
- `lib/vocabulary/verification/relationship-verifier.ts` — direct lexical proof or two-pass grounded relationship consensus.
- `lib/vocabulary/verification/evidence-import.ts` — provider evidence conversion through the existing dictionary importer.
- `lib/vocabulary/verification/mutation.ts` — pure batch status/link mutation and whole-snapshot validation.
- `lib/vocabulary/verification/report.ts` — sanitized deterministic report generation.
- `lib/vocabulary/verification/run-batch.ts` — bounded orchestration with dependency injection.
- `scripts/verify-advanced-vocabulary.ts` — local CLI and live dependency adapters.
- `scripts/fixtures/vocabulary-verification/source-backed-batch.json` — complete offline integration fixture.

---

### Task 1: Stable Candidate Model and Ranking

**Files:**
- Create: `lib/vocabulary/verification/types.ts`
- Create: `lib/vocabulary/verification/candidate-selector.ts`
- Create: `lib/vocabulary/verification/candidate-selector.test.ts`

**Interfaces:**
- Produces: `VerificationReasonCodeSchema` and `VerificationReasonCode`.
- Produces: `ReciprocalCoreAnchor` and `VerificationCandidate`.
- Produces: `selectAdvancedVerificationCandidates(records: readonly VocabularyRecord[], limit: number): VerificationCandidate[]`.
- Consumes: canonical `VocabularyRecord` and `VocabularyConnection`.

- [ ] **Step 1: Define the stable domain contracts**

Add these exported contracts to `types.ts`:

```ts
import { z } from "zod";
import type { VocabularyRecord } from "../schema";

export const VerificationReasonCodeSchema = z.enum([
  "published",
  "no_factual_sense",
  "pos_mismatch",
  "no_sourced_example",
  "sense_ambiguous",
  "no_reciprocal_anchor",
  "relationship_unsupported",
  "relationship_ambiguous",
  "judge_unavailable",
  "provider_failed",
  "budget_exhausted",
]);
export type VerificationReasonCode = z.infer<typeof VerificationReasonCodeSchema>;

export type ReciprocalCoreAnchor = {
  coreLemma: string;
  candidateType: "builds_on";
  coreType: "advanced_form";
  candidateGloss: string;
  coreGloss: string;
};

export type VerificationCandidate = {
  record: VocabularyRecord;
  anchors: ReciprocalCoreAnchor[];
  incomingPublishedCount: number;
  distinctPublishedCoreAnchors: number;
};
```

- [ ] **Step 2: Write ranking RED tests**

Use `vocabularyRecordFixture()` to construct published core records and hidden advanced records. Cover filtering, deduplication, reciprocal anchor extraction, ranking ties, and limit validation:

```ts
test("ranks hidden advanced records by incoming value, core anchors, then lemma", () => {
  const selected = selectAdvancedVerificationCandidates(records, 3);
  expect(selected.map((candidate) => candidate.record.lemma)).toEqual([
    "scrutinize",
    "manifest",
    "discern",
  ]);
  expect(selected[0]).toMatchObject({
    incomingPublishedCount: 4,
    distinctPublishedCoreAnchors: 3,
  });
});

test("excludes core, non-hidden, and non-advanced records", () => {
  expect(selectAdvancedVerificationCandidates(recordsWithIneligibleWords, 25)
    .map((candidate) => candidate.record.lemma)).toEqual(["scrutinize"]);
});

test("rejects a negative or non-integer limit", () => {
  expect(() => selectAdvancedVerificationCandidates(records, -1)).toThrow(
    "limit must be a non-negative integer",
  );
});
```

- [ ] **Step 3: Run the focused test and confirm RED**

Run: `npx vitest run lib/vocabulary/verification/candidate-selector.test.ts`

Expected: FAIL because the selector module does not exist.

- [ ] **Step 4: Implement deterministic selection**

Build a lemma map once. Count incoming `status: "published"` connections from public core records to each hidden advanced target. Extract an anchor only when the advanced record has a non-empty published `builds_on` edge back to that core record and the core record has a non-empty published `advanced_form` edge to the advanced record. Preserve both gloss strings without trimming them in the returned anchor.

Sort with:

```ts
candidates.sort((left, right) =>
  right.incomingPublishedCount - left.incomingPublishedCount
  || right.distinctPublishedCoreAnchors - left.distinctPublishedCoreAnchors
  || left.record.lemma.localeCompare(right.record.lemma),
);
```

- [ ] **Step 5: Verify and commit**

Run: `npx vitest run lib/vocabulary/verification/candidate-selector.test.ts`

Expected: PASS.

```bash
git add lib/vocabulary/verification/types.ts lib/vocabulary/verification/candidate-selector.ts lib/vocabulary/verification/candidate-selector.test.ts
git commit -m "feat: rank advanced verification candidates"
```

---

### Task 2: Normalize WordNet, DictionaryAPI, and Tatoeba Evidence

**Files:**
- Create: `lib/vocabulary/verification/provider-types.ts`
- Create: `lib/vocabulary/verification/wordnet-provider.ts`
- Create: `lib/vocabulary/verification/wordnet-provider.test.ts`
- Create: `lib/vocabulary/verification/http-providers.ts`
- Create: `lib/vocabulary/verification/http-providers.test.ts`

**Interfaces:**
- Produces: `FactualDictionaryEvidence` and `SourcedExampleEvidence`.
- Produces: `lookupWordNetEvidence(lemma, partOfSpeech, options): Promise<FactualDictionaryEvidence | null>`.
- Produces: `fetchDictionaryEvidence(lemma, partOfSpeech, options): Promise<FactualDictionaryEvidence | null>`.
- Produces: `fetchTatoebaExamples(lemma, forms, options): Promise<SourcedExampleEvidence[]>`.
- Consumes: existing `WordDetail` and `DictionaryImportSource` without changing either contract.

- [ ] **Step 1: Add provider-neutral evidence contracts**

```ts
import type { WordDetail } from "../../content/word-detail";
import type { DictionaryImportSource } from "../enrichment/dictionary-import";
import type { ContentSourceRef } from "../schema";

export type FactualProviderId = "wordnet" | "dictionaryapi";

export type FactualDictionaryEvidence = {
  provider: FactualProviderId;
  returnedLemma: string;
  requestedPartOfSpeech: string;
  detail: WordDetail;
  source: DictionaryImportSource;
};

export type SourcedExampleEvidence = {
  id: string;
  text: string;
  language: "eng";
  source: ContentSourceRef;
};
```

Provider-level `source` contains only `sourceId`, `url`, `retrievedAt`, and `contentHash`. Entry and sense IDs remain in `detail.sourceEntryId`, `detail.senses[].sourceEntryId`, and `detail.senses[].sourceSenseId` so `importDictionaryDetail()` generates the same canonical IDs on every run.

- [ ] **Step 2: Write exact-POS WordNet RED tests**

Inject a fake lookup object with `lookupNoun`, `lookupVerb`, `lookupAdjective`, `lookupAdverb`, and `seek` methods. Assert:

```ts
const evidence = await lookupWordNetEvidence("manifest", "verb", {
  lookup: fakeWordNet,
  retrievedAt: null,
});

expect(evidence).toMatchObject({
  provider: "wordnet",
  returnedLemma: "manifest",
  requestedPartOfSpeech: "verb",
  detail: {
    sourceEntryId: "verb:12345",
    senses: [{
      partOfSpeech: "verb",
      sourceEntryId: "verb:12345",
      sourceSenseId: "verb:12345",
    }],
  },
  source: { sourceId: "wordnet" },
});
```

Also prove noun-only evidence is rejected for a verb candidate, underscore lemmas normalize to spaces, and examples lacking a complete candidate token are omitted.

- [ ] **Step 3: Implement the exact-POS WordNet adapter**

Map canonical POS aliases to one exact lookup method:

```ts
const lookupMethod = {
  noun: "lookupNoun",
  verb: "lookupVerb",
  adjective: "lookupAdjective",
  adverb: "lookupAdverb",
} as const;
```

Return one `WordDetail` sense per WordNet synset in provider order, with a stable `pos:synsetOffset` external ID. Retain definitions and examples exactly as returned; normalize only lemmas and synonym matching keys. Return `null` for unsupported POS or no exact-POS synsets.

- [ ] **Step 4: Write HTTP-provider RED tests**

Inject `fetch` and a deterministic `now` function. Dictionary tests must prove returned lemma and exact POS are retained, all provenance URLs/IDs survive normalization, 404 returns `null`, 429/5xx retry no more than twice, timeout becomes a typed provider failure, and response bodies never appear in thrown messages.

Tatoeba tests must prove:

```ts
expect(await fetchTatoebaExamples("obtain", ["obtain", "obtained"], {
  fetch: fakeFetch,
  now: fixedNow,
})).toEqual([{
  id: "tatoeba:8842",
  text: "She obtained permission to enter.",
  language: "eng",
  source: expect.objectContaining({
    sourceId: "tatoeba",
    externalId: "8842",
    url: "https://tatoeba.org/en/sentences/show/8842",
  }),
}]);
```

Reject non-English sentences, substring-only matches such as `train` in `training` when `training` is not a supplied canonical form, duplicate sentence IDs, and blank text.

- [ ] **Step 5: Implement bounded HTTP adapters**

Use `encodeURIComponent` for query values, `AbortSignal.timeout(15_000)`, and two total attempts for 429/5xx/network timeout. Normalize provider payloads immediately into the contracts above and discard unneeded raw fields. Hash the normalized retained content with SHA-256 for `contentHash`.

The adapters return typed failures to the orchestrator instead of logging provider bodies. A 404/no-results response is a valid empty result, not a process crash.

- [ ] **Step 6: Verify and commit**

Run: `npx vitest run lib/vocabulary/verification/wordnet-provider.test.ts lib/vocabulary/verification/http-providers.test.ts`

Run: `npx tsc --noEmit`

Expected: both commands pass without network access.

```bash
git add lib/vocabulary/verification/provider-types.ts lib/vocabulary/verification/wordnet-provider.ts lib/vocabulary/verification/wordnet-provider.test.ts lib/vocabulary/verification/http-providers.ts lib/vocabulary/verification/http-providers.test.ts
git commit -m "feat: normalize advanced verification evidence"
```

---

### Task 3: Resumable Cache and Hard Source Budget

**Files:**
- Create: `lib/vocabulary/verification/cache.ts`
- Create: `lib/vocabulary/verification/cache.test.ts`
- Create: `lib/vocabulary/verification/source-budget.ts`
- Create: `lib/vocabulary/verification/source-budget.test.ts`
- Modify: `.gitignore`

**Interfaces:**
- Produces: `canonicalVerificationJson(value: unknown): string`.
- Produces: `verificationCacheKey(input: CacheKeyInput): string`.
- Produces: `readVerificationCache<T>(root, key, schema): Promise<T | null>`.
- Produces: `writeVerificationCache<T>(root, key, value, schema): Promise<void>`.
- Produces: `createVerificationCache(root): VerificationCache`, the orchestrator-facing wrapper around those functions.
- Produces: `SourceRequestBudget` with `reserve(requestId)`, `remaining()`, and `used()`.

- [ ] **Step 1: Write cache RED tests**

Cover key-order-independent hashes, provider/request version changes, model/prompt version changes, validated reads, corrupt/truncated JSON as cache misses, and atomic replacement:

```ts
expect(verificationCacheKey({
  provider: "dictionaryapi",
  version: "v1",
  request: { lemma: "manifest", pos: "verb" },
})).toBe(verificationCacheKey({
  provider: "dictionaryapi",
  version: "v1",
  request: { pos: "verb", lemma: "manifest" },
}));

await writeVerificationCache(root, key, evidence, EvidenceSchema);
expect(await readVerificationCache(root, key, EvidenceSchema)).toEqual(evidence);
```

- [ ] **Step 2: Implement canonical hashing and atomic cache I/O**

Recursively sort object keys, retain array order, serialize with `JSON.stringify`, and hash with SHA-256. Store each validated value as `<root>/<provider>/<sha256>.json`. Write a process-specific temporary file and rename it. If parsing or Zod validation fails, return `null` and let the caller refetch.

Do not store request headers, environment variables, prompts, or raw model replies.

Expose the typed wrapper used in Task 7:

```ts
export interface VerificationCache {
  get<T>(namespace: string, key: string, schema: z.ZodType<T>): Promise<T | null>;
  set<T>(namespace: string, key: string, value: T, schema: z.ZodType<T>): Promise<void>;
}

export function createVerificationCache(root: string): VerificationCache;
```

- [ ] **Step 3: Write source-budget RED tests**

```ts
const budget = new SourceRequestBudget(2);
expect(budget.reserve("dictionary:manifest")).toBe(true);
expect(budget.reserve("dictionary:manifest")).toBe(true);
expect(budget.reserve("tatoeba:manifest")).toBe(true);
expect(budget.reserve("dictionary:scrutinize")).toBe(false);
expect(budget.used()).toBe(2);
```

Also reject negative/non-integer ceilings.

- [ ] **Step 4: Implement idempotent source reservations**

Count a request ID once so retries and cache rechecks do not double-charge. Cache hits must bypass `reserve()` entirely; only an actual outbound provider attempt reserves a source request.

- [ ] **Step 5: Ignore the cache and verify**

Add exactly:

```gitignore
/.cache/vocabulary-verification/
```

Run: `npx vitest run lib/vocabulary/verification/cache.test.ts lib/vocabulary/verification/source-budget.test.ts`

Run: `git check-ignore .cache/vocabulary-verification/example.json`

Expected: tests pass and the cache path is printed.

- [ ] **Step 6: Commit**

```bash
git add .gitignore lib/vocabulary/verification/cache.ts lib/vocabulary/verification/cache.test.ts lib/vocabulary/verification/source-budget.ts lib/vocabulary/verification/source-budget.test.ts
git commit -m "feat: cache vocabulary verification requests"
```

---

### Task 4: Grounded Sense Selection

**Files:**
- Create: `lib/vocabulary/verification/decision-schema.ts`
- Create: `lib/vocabulary/verification/decision-schema.test.ts`
- Create: `lib/vocabulary/verification/sense-verifier.ts`
- Create: `lib/vocabulary/verification/sense-verifier.test.ts`
- Modify: `lib/vocabulary/enrichment/dictionary-import.ts`
- Modify: `lib/vocabulary/enrichment/dictionary-import.test.ts`

**Interfaces:**
- Produces: `SenseSelectionDecisionSchema` and `RelationshipDecisionSchema`.
- Produces: `dictionarySenseId(record, detail, sense, sourceId): string` from the existing importer.
- Produces: `eligibleFactualSenses(candidate, evidence): EligibleFactualSense[]`.
- Produces: `verifyCandidateSense(input, judge): Promise<SenseVerificationResult>`.
- Consumes: `FactualDictionaryEvidence[]`, `SourcedExampleEvidence[]`, and the existing `TokenBudget`.

- [ ] **Step 1: Define strict finite decision schemas**

```ts
export const SenseSelectionDecisionSchema = z.discriminatedUnion("decision", [
  z.object({
    decision: z.literal("selected"),
    senseId: z.string().min(1),
    exampleId: z.string().min(1).nullable(),
  }).strict(),
  z.object({
    decision: z.literal("ambiguous"),
    senseId: z.null(),
    exampleId: z.null(),
  }).strict(),
]);

export const RelationshipDecisionSchema = z.object({
  decision: z.enum(["supported", "unsupported", "ambiguous"]),
  candidateSenseId: z.string().min(1),
  coreLemma: z.string().min(1),
}).strict();
```

Tests reject extra keys such as `definition`, `example`, `sourceId`, `status`, `gloss`, and `target`.

- [ ] **Step 2: Run schema tests and confirm RED**

Run: `npx vitest run lib/vocabulary/verification/decision-schema.test.ts`

Expected: FAIL because the schemas do not exist.

- [ ] **Step 3: Implement eligible factual sense extraction**

For each provider detail:

- normalize and compare `returnedLemma` to the candidate lemma;
- require exact mapped POS;
- reject blank and placeholder definitions;
- derive the future canonical sense ID with the shared `dictionarySenseId()` helper;
- retain only registered factual source references;
- accept dictionary/WordNet examples only when they contain a canonical form as a complete Unicode-aware token.

Deduplicate by canonical sense ID without changing provider wording.

First export `dictionarySenseId()` from `dictionary-import.ts` and make
`importDictionaryDetail()` call that same helper. Add a regression test proving the
verifier's predicted ID equals the ID later persisted by the importer when the source
does not supply a sense ID or entry ID.

- [ ] **Step 4: Write sense-verifier RED tests**

Cover:

- zero eligible senses → `no_factual_sense` or `pos_mismatch`;
- one eligible sense with a factual matching dictionary example → deterministic selection with no judge call;
- multiple eligible senses → judge can select only a supplied ID;
- unknown ID, malformed shape, or equal ambiguity → `sense_ambiguous`;
- Tatoeba example attaches only when the judge returns that supplied example ID for the selected sense;
- no matching factual example → `no_sourced_example`;
- exhausted token budget → `budget_exhausted`;
- absent judge when a decision is required → `judge_unavailable`.

```ts
expect(await verifyCandidateSense(input, neverCalledJudge)).toMatchObject({
  selectedSenseId: "dictionaryapi:manifest:verb:1",
  reason: null,
  decisionSource: "deterministic",
});
```

- [ ] **Step 5: Implement grounded finite selection**

The judge input contains only candidate lemma/POS/forms, eligible sense IDs with factual wording, and finite sourced example IDs/text. Its return type is:

```ts
export type SenseVerificationResult = {
  eligibleSenses: EligibleFactualSense[];
  selectedSenseId: string | null;
  selectedExampleId: string | null;
  reason: VerificationReasonCode | null;
  decisionSource: "deterministic" | "llm" | "unavailable";
  usage: TokenUsage;
};
```

Validate the returned IDs against the exact finite sets after Zod parsing. Reserve the estimated request in `TokenBudget` before calling the judge and settle actual usage once.

- [ ] **Step 6: Verify and commit**

Run: `npx vitest run lib/vocabulary/verification/decision-schema.test.ts lib/vocabulary/verification/sense-verifier.test.ts`

Run: `npx tsc --noEmit`

```bash
git add lib/vocabulary/enrichment/dictionary-import.ts lib/vocabulary/enrichment/dictionary-import.test.ts lib/vocabulary/verification/decision-schema.ts lib/vocabulary/verification/decision-schema.test.ts lib/vocabulary/verification/sense-verifier.ts lib/vocabulary/verification/sense-verifier.test.ts
git commit -m "feat: verify source-backed vocabulary senses"
```

---

### Task 5: Reciprocal Relationship Verification

**Files:**
- Create: `lib/vocabulary/verification/relationship-verifier.ts`
- Create: `lib/vocabulary/verification/relationship-verifier.test.ts`

**Interfaces:**
- Produces: `verifyCandidateRelationships(input, judge): Promise<RelationshipVerificationResult>`.
- Consumes: `ReciprocalCoreAnchor[]`, the selected factual sense, candidate synonym evidence, published factual core senses, `RelationshipDecisionSchema`, and `TokenBudget`.
- Produces one immutable `AnchorDecision` for every existing reciprocal pair.

- [ ] **Step 1: Write direct-evidence RED tests**

Prove exact normalized synonym support avoids all model calls:

```ts
const result = await verifyCandidateRelationships({
  candidate,
  selectedSense,
  anchors,
  factualSynonyms: ["examine", "scrutinise"],
  coreRecords,
  tokenBudget,
}, neverCalledJudge);

expect(result.decisions[0]).toMatchObject({
  coreLemma: "examine",
  decision: "supported",
  method: "direct_lexical",
});
expect(result.decisions[0].candidateGloss).toBe(originalCandidateGloss);
expect(result.decisions[0].coreGloss).toBe(originalCoreGloss);
```

Do not accept substring, stemming, connection type alone, or an LLM-only core sense as direct evidence.

- [ ] **Step 2: Write two-pass judge RED tests**

Cover:

- two order-reversed `supported` responses → supported;
- two `unsupported` responses → unsupported;
- disagreement → ambiguous;
- malformed response, wrong sense ID, or wrong core lemma → ambiguous;
- missing published factual core sense → ambiguous without a model call;
- exhausted token budget → `budget_exhausted`;
- absent judge → `judge_unavailable`;
- empty/missing reciprocal gloss or missing reverse edge → `no_reciprocal_anchor`.

- [ ] **Step 3: Run focused tests and confirm RED**

Run: `npx vitest run lib/vocabulary/verification/relationship-verifier.test.ts`

Expected: FAIL because the verifier does not exist.

- [ ] **Step 4: Implement deterministic and consensus gates**

Normalize lexical comparison keys only; never alter stored wording. For non-direct pairs, construct two requests containing the same finite evidence but reverse candidate/core presentation order. Require both strict responses to echo the supplied `candidateSenseId` and `coreLemma`.

Export:

```ts
export type AnchorDecision = ReciprocalCoreAnchor & {
  decision: "supported" | "unsupported" | "ambiguous";
  method: "direct_lexical" | "llm_consensus" | "llm_disagreement" | "unavailable";
  reason: VerificationReasonCode | null;
};

export type RelationshipVerificationResult = {
  decisions: AnchorDecision[];
  hasSupportedAnchor: boolean;
  usage: TokenUsage;
};
```

- [ ] **Step 5: Verify exact gloss preservation**

Include tabs, repeated spaces, punctuation, and non-ASCII characters in fixture glosses. Assert each returned `candidateGloss` and `coreGloss` is byte-for-byte equal to the input string.

Run: `npx vitest run lib/vocabulary/verification/relationship-verifier.test.ts`

Run: `npx tsc --noEmit`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add lib/vocabulary/verification/relationship-verifier.ts lib/vocabulary/verification/relationship-verifier.test.ts
git commit -m "feat: verify reciprocal vocabulary relationships"
```

---

### Task 6: Idempotent Evidence Import and Pure Batch Mutation

**Files:**
- Create: `lib/vocabulary/verification/evidence-import.ts`
- Create: `lib/vocabulary/verification/evidence-import.test.ts`
- Create: `lib/vocabulary/verification/mutation.ts`
- Create: `lib/vocabulary/verification/mutation.test.ts`

**Interfaces:**
- Produces: `importVerificationEvidence(record, dictionaryEvidence, selectedSenseId, selectedExample): VocabularyRecord`.
- Produces: `applyVerificationOutcomes(records, outcomes): VerificationMutationResult`.
- Consumes: `importDictionaryDetail()`, `isSensePublishable()`, and `publicationStatusFor()`.

- [ ] **Step 1: Write evidence-import RED tests**

Import WordNet and DictionaryAPI details by repeatedly calling the existing `importDictionaryDetail()`. If a selected Tatoeba example is not already present, append it only to the selected factual sense with the original sentence text and factual `ContentSourceRef`.

Assert:

```ts
const first = importVerificationEvidence(record, evidence, selectedSenseId, selectedExample);
const repeated = importVerificationEvidence(first, evidence, selectedSenseId, selectedExample);

expect(repeated).toEqual(first);
expect(first.senses.find((sense) => sense.id === selectedSenseId)?.examples)
  .toContainEqual({ text: selectedExample.text, sources: [selectedExample.source] });
```

Also prove provider definition whitespace, example wording, URLs, external IDs, and retrieval metadata remain unchanged.

- [ ] **Step 2: Implement evidence import**

Use canonical sense IDs to locate the selected sense. Deduplicate source references by all five persisted fields and examples by exact text plus exact source-reference arrays. Validate the returned record with `VocabularyRecordSchema.parse()`.

- [ ] **Step 3: Write mutation RED tests**

Build a snapshot with one hidden advanced record and two published core anchors. Test:

- passing candidate: selected factual sense `published`, old LLM-only senses `hidden`, other factual senses `review`, record `status: "enriched"` and `publicationStatus: "published"`;
- supported reciprocal pair stays/becomes `published` both directions;
- unsupported and ambiguous pairs become `unreviewed` both directions;
- non-passing candidate keeps imported facts but remains `hidden`;
- no new connection or target is created;
- exact supported gloss strings remain unchanged;
- duplicate outcomes and repeated mutation are byte-identical;
- malformed whole snapshots throw before returning updates.

- [ ] **Step 4: Implement whole-snapshot mutation**

Use this contract:

```ts
export type CandidateVerificationOutcome = {
  candidateLemma: string;
  dictionaryEvidence: FactualDictionaryEvidence[];
  selectedExample: SourcedExampleEvidence | null;
  selectedSenseId: string | null;
  relationships: AnchorDecision[];
  reason: VerificationReasonCode;
};

export type VerificationMutationResult = {
  snapshot: VocabularyRecord[];
  updates: VocabularyRecord[];
  publishedLemmas: string[];
  downgradedRelationshipCount: number;
};
```

Apply outcomes to a cloned lemma map, then validate every record. For a proposed publication, assert the selected sense passes `isSensePublishable()` and the final candidate status remains `published` under `publicationStatusFor(candidate, snapshot)`. Throw on duplicate candidate outcomes, missing records, missing reciprocal pairs, or identity mismatches.

- [ ] **Step 5: Verify and commit**

Run: `npx vitest run lib/vocabulary/verification/evidence-import.test.ts lib/vocabulary/verification/mutation.test.ts lib/vocabulary/publication.test.ts`

Run: `npx tsc --noEmit`

```bash
git add lib/vocabulary/verification/evidence-import.ts lib/vocabulary/verification/evidence-import.test.ts lib/vocabulary/verification/mutation.ts lib/vocabulary/verification/mutation.test.ts
git commit -m "feat: apply verified vocabulary publication updates"
```

---

### Task 7: Bounded Orchestrator and Sanitized Report

**Files:**
- Create: `lib/vocabulary/verification/report.ts`
- Create: `lib/vocabulary/verification/report.test.ts`
- Create: `lib/vocabulary/verification/run-batch.ts`
- Create: `lib/vocabulary/verification/run-batch.test.ts`

**Interfaces:**
- Produces: `VerificationReportSchema` and `VerificationReport`.
- Produces: `runVerificationBatch(options, dependencies): Promise<VerificationRunResult>`.
- Consumes: Tasks 1–6 through injected provider, judge, cache, persistence, and graph-build dependencies.

- [ ] **Step 1: Define and test the report contract**

The strict Zod report includes:

```ts
{
  version: 1,
  mode: "dry-run" | "write",
  selected: number,
  attempted: number,
  sourceBacked: number,
  published: number,
  ambiguous: number,
  unsupported: number,
  failed: number,
  relationships: {
    accepted: number,
    rejected: number,
    ambiguous: number,
    downgraded: number,
  },
  cache: {
    wordnet: { hits: number, misses: number },
    dictionaryapi: { hits: number, misses: number },
    tatoeba: { hits: number, misses: number },
    llm: { hits: number, misses: number },
  },
  requests: { source: number, llm: number },
  tokenUsage: { inputTokens: number, outputTokens: number },
  changedShards: string[],
  entries: Array<{ lemma: string, reason: VerificationReasonCode }>,
  remaining: {
    hiddenAdvanced: number,
    strictViolations: DictionaryStrictViolationCounts,
  },
}
```

Sort `changedShards` and entries. Bound entries to the selected batch size. A recursive key scan rejects `prompt`, `response`, `raw`, `authorization`, `apiKey`, `secret`, and `token` except the aggregate `tokenUsage` key.

- [ ] **Step 2: Write orchestration RED tests**

Inject all side effects. Cover:

- deterministic selection and bounded concurrency;
- cache hit skips provider/model calls and budgets;
- source budget stops before the next external call;
- token budget stops before the next model call;
- provider failure hides the candidate with `provider_failed`;
- direct lexical support works without an LLM;
- judge-required work without a configured judge returns `judge_unavailable`;
- all outcomes are calculated before persistence;
- dry-run never calls persist or build;
- write with no updates calls neither persist nor build;
- changed write calls persist once with all updates, then build once;
- persistence error prevents build;
- graph-build failure propagates a non-zero-result error after canonical changes;
- the same cached batch is idempotent.

- [ ] **Step 3: Run tests and confirm RED**

Run: `npx vitest run lib/vocabulary/verification/report.test.ts lib/vocabulary/verification/run-batch.test.ts`

Expected: FAIL because report and orchestrator modules do not exist.

- [ ] **Step 4: Implement bounded orchestration**

Export:

```ts
export type VerificationRunOptions = {
  limit: number;
  concurrency: number;
  maxSourceRequests: number;
  maxInputTokens: number;
  maxOutputTokens: number;
  write: boolean;
};

export type VerificationDependencies = {
  loadRecords(): Promise<VocabularyRecord[]>;
  cache: VerificationCache;
  getWordNet(candidate: VerificationCandidate): Promise<FactualDictionaryEvidence | null>;
  getDictionary(candidate: VerificationCandidate): Promise<FactualDictionaryEvidence | null>;
  getTatoeba(candidate: VerificationCandidate): Promise<SourcedExampleEvidence[]>;
  judgeSense: SenseJudge | null;
  judgeRelationship: RelationshipJudge | null;
  persist(updates: VocabularyRecord[]): Promise<string[]>;
  buildGraphs(): Promise<void>;
};
```

Use a fixed worker pool no larger than `concurrency`. Stop scheduling new candidates once a budget is exhausted, but allow already-started candidates to finish. Sort all completed outcomes back into candidate order before mutation and reporting.

When sense verification fails before relationship judging, emit an `ambiguous`
`AnchorDecision` for every existing reciprocal anchor. This gives the mutation engine
a complete finite decision set and safely downgrades those learner-facing pairs in
both directions while retaining imported facts.

- [ ] **Step 5: Validate before persistence**

Run `VocabularyRecordSchema.parse()` for the complete proposed snapshot, `lintVocabularyRecords()` for newly introduced identities, and `auditDictionaryRecords()` for final counts. Reject any new lint/audit identity before calling `persist()`. The inherited corpus debt may remain or decrease.

- [ ] **Step 6: Verify and commit**

Run: `npx vitest run lib/vocabulary/verification/report.test.ts lib/vocabulary/verification/run-batch.test.ts`

Run: `npx tsc --noEmit`

```bash
git add lib/vocabulary/verification/report.ts lib/vocabulary/verification/report.test.ts lib/vocabulary/verification/run-batch.ts lib/vocabulary/verification/run-batch.test.ts
git commit -m "feat: orchestrate automatic vocabulary verification"
```

---

### Task 8: Local CLI, Complete Fixture, and Operating Documentation

**Files:**
- Create: `scripts/verify-advanced-vocabulary.ts`
- Create: `scripts/verify-advanced-vocabulary.test.ts`
- Create: `scripts/fixtures/vocabulary-verification/source-backed-batch.json`
- Modify: `package.json`
- Modify: `README.md`
- Modify: `CLAUDE.md`
- Modify: `wiki/CLAUDE.md`

**Interfaces:**
- Produces CLI: `npm run verify:advanced -- [options]`.
- Supports: `--limit`, `--concurrency`, `--max-source-requests`, `--max-input-tokens`, `--max-output-tokens`, `--cache`, `--report`, `--fixture`, and `--write`.
- Adapts the existing `completeJSONResult()` to `SenseJudge` and `RelationshipJudge`.

- [ ] **Step 1: Create the complete offline fixture**

Include at least:

- one exact-POS dictionary example that publishes without a model call;
- one WordNet synonym relation that publishes without a relationship model call;
- one Tatoeba sentence that needs grounded sense matching;
- one relationship requiring two agreeing model decisions;
- one ambiguous sense;
- one unsupported relationship;
- one provider failure;
- exact reciprocal glosses containing repeated spaces and punctuation.

The fixture stores normalized provider/model results only. It does not contain credentials, HTTP headers, raw provider payloads, or prose model responses.

- [ ] **Step 2: Write CLI RED tests**

Call the exported runner against a temporary canonical root and fixture. Assert:

```ts
expect(parseVerificationArgs([])).toMatchObject({
  limit: 25,
  concurrency: 3,
  maxSourceRequests: 100,
  maxInputTokens: 20_000,
  maxOutputTokens: 8_000,
  write: false,
});
expect(() => parseVerificationArgs(["--concurrency=6"])).toThrow(
  "--concurrency must be an integer from 1 to 5",
);
```

Fixture mode must fail closed if a requested fixture key is absent; it must never fall through to live fetch or LLM. Dry-run must leave canonical and generated files unchanged. `--write` must modify the temporary shards once and invoke the injected graph builder once.

Export a testable boundary instead of adding a hidden filesystem CLI option:

```ts
export type VerificationCliRuntime = {
  vocabularyRoot: string;
  createCache(root: string): VerificationCache;
  buildGraphs(): Promise<void>;
  wordNet: VerificationDependencies["getWordNet"];
  dictionary: VerificationDependencies["getDictionary"];
  tatoeba: VerificationDependencies["getTatoeba"];
  judgeSense: SenseJudge | null;
  judgeRelationship: RelationshipJudge | null;
};

export function runVerificationCli(
  argv: readonly string[],
  runtime: VerificationCliRuntime,
): Promise<VerificationRunResult>;
```

Tests call `runVerificationCli()` with temporary roots and injected functions.
Production `main()` supplies `process.cwd()` paths and live adapters.

- [ ] **Step 3: Implement argument parsing and adapters**

Add:

```json
"verify:advanced": "tsx scripts/verify-advanced-vocabulary.ts"
```

Resolve cache/report/fixture paths from `process.cwd()`. Use `completeJSONResult()` with stable request IDs, two attempts, bounded `maxOutputTokens`, and fallback usage reservations. If no LLM key exists, direct lexical candidates may still pass; any required model decision returns `judge_unavailable`.

Use `writeVocabularyRecords(path.join(process.cwd(), "content", "vocabulary"), updates)` for persistence. Spawn `npm run build:graphs` only through the orchestrator's post-write callback and propagate its exit code.

- [ ] **Step 4: Emit a sanitized deterministic report**

Write reports atomically after Zod validation. Console output may show aggregate counts and the bounded lemma/reason list only. It must not print prompts, model responses, source bodies, or environment values.

- [ ] **Step 5: Document the operating contract**

Update all three documents with:

```bash
# Offline, zero-cost integration check
npm run verify:advanced -- \
  --fixture=scripts/fixtures/vocabulary-verification/source-backed-batch.json \
  --report=.cache/vocabulary-verification/fixture-report.json

# Live dry-run; canonical NDJSON remains untouched
npm run verify:advanced -- \
  --limit=25 \
  --concurrency=3 \
  --max-source-requests=100 \
  --max-input-tokens=20000 \
  --max-output-tokens=8000 \
  --report=.cache/vocabulary-verification/latest-report.json

# Apply the exact cached batch and rebuild generated artifacts
npm run verify:advanced -- \
  --limit=25 \
  --concurrency=3 \
  --max-source-requests=100 \
  --max-input-tokens=20000 \
  --max-output-tokens=8000 \
  --report=.cache/vocabulary-verification/latest-write-report.json \
  --write
```

State explicitly that canonical NDJSON and regenerated artifacts are reviewed in Git, the cache is disposable, uncertain records stay hidden, and this command does not run in Vercel.

- [ ] **Step 6: Verify and commit**

Run: `npx vitest run scripts/verify-advanced-vocabulary.test.ts lib/vocabulary/verification`

Run: `npx tsc --noEmit`

Expected: PASS with no network calls.

```bash
git add scripts/verify-advanced-vocabulary.ts scripts/verify-advanced-vocabulary.test.ts scripts/fixtures/vocabulary-verification/source-backed-batch.json package.json README.md CLAUDE.md wiki/CLAUDE.md
git commit -m "feat: add automatic advanced vocabulary verifier"
```

---

### Task 9: Release Gates and First 25-Word Cached Batch

**Files:**
- Modify only after a successful write: `content/vocabulary/*.ndjson`
- Regenerate only after a successful changed write: `data/generated/**` and `public/generated/**`
- Create only outside Git: `.cache/vocabulary-verification/first-live-report.json`
- Create only outside Git: `.cache/vocabulary-verification/first-live-write-report.json`
- Create only outside Git: `.cache/vocabulary-verification/base-audit.json`
- Create only outside Git: `.cache/vocabulary-verification/base-lint.json`
- Create only outside Git: `.cache/vocabulary-verification/base-lint-exit-code.txt`
- Create only outside Git: `.cache/vocabulary-verification/current-lint.json`

**Interfaces:**
- Consumes the completed CLI from Task 8.
- Produces the first source-backed canonical batch only when every gate below passes.

- [ ] **Step 1: Run fixture and full static verification**

Run:

```bash
npm run verify:advanced -- \
  --fixture=scripts/fixtures/vocabulary-verification/source-backed-batch.json \
  --report=.cache/vocabulary-verification/fixture-report.json
npm test
npx tsc --noEmit
npm run build
```

Expected: fixture report validates, all Vitest tests pass, TypeScript exits 0, and the production build succeeds.

- [ ] **Step 2: Capture inherited lint and strict-audit baselines**

Run:

```bash
mkdir -p .cache/vocabulary-verification
set +e
npx tsx scripts/lint-vocabulary.ts --json \
  > .cache/vocabulary-verification/base-lint.json
base_lint_exit=$?
set -e
printf '%s\n' "$base_lint_exit" \
  > .cache/vocabulary-verification/base-lint-exit-code.txt
npx tsx scripts/gate-vocabulary-lint.ts \
  --validate=.cache/vocabulary-verification/base-lint.json \
  --exit-code="$base_lint_exit"
npx tsx scripts/audit-dictionary.ts --json \
  > .cache/vocabulary-verification/base-audit.json
```

The inherited vocabulary violations currently make the lint exit code 1. The
validation command proves that this exit is a complete lint result rather than a
crash. Capture `audit-dictionary.ts --json` as the strict baseline.

The execution notes must record the exact commands and exit codes; do not claim a clean corpus while inherited debt remains.

- [ ] **Step 3: Run the live 25-word dry-run**

```bash
npm run verify:advanced -- \
  --limit=25 \
  --concurrency=3 \
  --max-source-requests=100 \
  --max-input-tokens=20000 \
  --max-output-tokens=8000 \
  --report=.cache/vocabulary-verification/first-live-report.json
```

Expected: canonical and generated Git diffs remain empty; the report contains no forbidden sensitive keys; selected candidates follow Task 1 ranking.

If network access, a factual provider, or the configured model is unavailable, stop this rollout at dry-run, report the exact sanitized reason, and do not invoke `--write`.

- [ ] **Step 4: Prove dry-run cache idempotence**

Run the same command again.

Expected: the second report has the same candidate outcomes and increased cache-hit counts, with no new canonical or generated diff.

- [ ] **Step 5: Apply the same cached batch**

Only when Step 3 completed without infrastructure failure:

```bash
npm run verify:advanced -- \
  --limit=25 \
  --concurrency=3 \
  --max-source-requests=100 \
  --max-input-tokens=20000 \
  --max-output-tokens=8000 \
  --report=.cache/vocabulary-verification/first-live-write-report.json \
  --write
```

Expected: only validated vocabulary shards and regenerated graph/galaxy artifacts change. If zero candidates pass and no reciprocal links change, the command reports zero changed shards and skips graph generation.

- [ ] **Step 6: Gate the changed corpus against both baselines**

Run:

```bash
npm test
npx tsc --noEmit
npm run lint
npm run audit:dictionary
npm run audit:dictionary -- --strict --base-manifest=.cache/vocabulary-verification/base-audit.json
npm run build:graphs
npm run build
```

Compare the current vocabulary-lint identities exactly:

```bash
base_lint_exit=$(tr -d '[:space:]' \
  < .cache/vocabulary-verification/base-lint-exit-code.txt)
set +e
npx tsx scripts/lint-vocabulary.ts --json \
  > .cache/vocabulary-verification/current-lint.json
current_lint_exit=$?
set -e
npx tsx scripts/gate-vocabulary-lint.ts \
  --base=.cache/vocabulary-verification/base-lint.json \
  --current=.cache/vocabulary-verification/current-lint.json \
  --base-exit-code="$base_lint_exit" \
  --current-exit-code="$current_lint_exit"
```

Expected: no new lint identity, no new strict-audit identity, every newly public word
has a publishable selected sense and supported public core anchor, and builds pass.

If the pre-existing application ESLint error in `components/network/star-atlas.tsx` still exists, report it as inherited and do not include an unrelated suppression in this feature. Fix it in a separate scoped change before declaring the complete release gate green.

- [ ] **Step 7: Re-run the cached write for canonical idempotence**

Run the Step 5 command once more.

Expected: zero changed shards and no generated artifact changes.

- [ ] **Step 8: Review and commit only verified content**

Inspect:

```bash
git status --short
git diff --check
git diff --stat
```

Confirm no file under `.cache/` is staged. If the write changed verified content:

```bash
git add content/vocabulary data/generated public/generated
git commit -m "content: verify first advanced vocabulary batch"
```

If the write produced zero canonical changes, do not create an empty content commit.

---

## Final Self-Review Checklist

- Every approved design requirement maps to Tasks 1–9.
- No provider/model call exists inside a request-time Next.js route.
- Candidate ranking, exact POS, factual provenance, sourced-example matching, reciprocal relationships, and publication gates all have focused tests.
- Direct lexical proof and two-pass model consensus are separate paths.
- Model outputs are strict finite decisions and cannot inject learner content.
- Supported connection glosses are never normalized or rewritten.
- Rejected and ambiguous reciprocal links are downgraded symmetrically.
- Imported facts remain available on non-passing hidden candidates.
- Cache keys include provider/request versions and model/prompt/evidence identity.
- Dry-run, budget exhaustion, interruption, corrupted cache, graph failure, and repeated runs have explicit behavior.
- Persistence receives one completely validated batch.
- Reports are deterministic, bounded, and sanitized.
- Fixture tests cannot fall through to live APIs.
- The first live write occurs only after a successful cached dry-run and is checked against inherited lint/audit identities.
