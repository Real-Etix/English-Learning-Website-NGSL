import { createHash } from "node:crypto";

import { z } from "zod";

import { lintVocabularyRecords, type Finding } from "../../../scripts/lint-vocabulary";
import { TokenBudget, type TokenUsage } from "../enrichment/budget";
import { VocabularyRecordSchema, type VocabularyRecord } from "../schema";
import {
  auditDictionaryRecords,
  strictViolationIdentityRegressions,
  strictViolationRegressions,
  type DictionaryQualityReport,
} from "../../wiki/dictionary-quality";
import { type VerificationCache, verificationCacheKey } from "./cache";
import { selectAdvancedVerificationCandidates } from "./candidate-selector";
import {
  applyVerificationOutcomes,
  type CandidateVerificationOutcome,
  type VerificationMutationResult,
} from "./mutation";
import type { FactualDictionaryEvidence, SourcedExampleEvidence } from "./provider-types";
import {
  verifyCandidateRelationships,
  type AnchorDecision,
  type RelationshipJudge,
  type RelationshipVerificationResult,
} from "./relationship-verifier";
import { createVerificationReport, normalizeChangedShards, type VerificationReport } from "./report";
import {
  verifyCandidateSense,
  type SenseJudge,
  type SenseVerificationResult,
} from "./sense-verifier";
import { SourceRequestBudget } from "./source-budget";
import {
  VerificationReasonCodeSchema,
  type ReciprocalCoreAnchor,
  type VerificationCandidate,
  type VerificationReasonCode,
} from "./types";

const VerificationBatchRecordStateSchema = z.object({
  lemma: z.string().min(1),
  beforeHash: z.string().regex(/^sha256:[0-9a-f]{64}$/u),
  afterHash: z.string().regex(/^sha256:[0-9a-f]{64}$/u),
}).strict();

export const VerificationBatchEntrySchema = z.object({
  lemma: z.string().min(1),
  anchors: z.array(z.object({
    coreLemma: z.string().min(1),
    candidateType: z.literal("builds_on"),
    coreType: z.literal("advanced_form"),
    candidateGloss: z.string().refine((value) => value.trim().length > 0),
    coreGloss: z.string().refine((value) => value.trim().length > 0),
  }).strict()),
  expectedRecords: z.array(VerificationBatchRecordStateSchema).min(1),
}).strict();

export type VerificationBatchEntry = z.infer<typeof VerificationBatchEntrySchema>;

export type VerificationRunOptions = {
  limit: number;
  concurrency: number;
  maxSourceRequests: number;
  maxInputTokens: number;
  maxOutputTokens: number;
  write: boolean;
  signal?: AbortSignal;
  batch?: readonly VerificationBatchEntry[];
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
  estimatedSenseUsage?: TokenUsage;
  estimatedRelationshipUsage?: TokenUsage;
  modelId?: string;
  lintRecords?: (records: VocabularyRecord[]) => Finding[];
  auditRecords?: (records: VocabularyRecord[]) => DictionaryQualityReport;
};

export type VerificationRunResult = {
  report: VerificationReport;
  batch: VerificationBatchEntry[];
  outcomes: CandidateVerificationOutcome[];
  mutation: VerificationMutationResult;
};

type ProviderName = "wordnet" | "dictionaryapi" | "tatoeba";
type CacheStats = VerificationReport["cache"];
type RunStats = {
  cache: CacheStats;
  sourceRequests: number;
  llmRequests: number;
  tokenUsage: TokenUsage;
};

type CandidateProcessResult = {
  outcome: CandidateVerificationOutcome;
  stopScheduling: boolean;
};

class SourceBudgetExhaustedError extends Error {
  readonly name = "SourceBudgetExhaustedError";
}

const ZERO_USAGE: TokenUsage = { inputTokens: 0, outputTokens: 0 };
const DEFAULT_SENSE_USAGE: TokenUsage = { inputTokens: 2_000, outputTokens: 200 };
const DEFAULT_RELATIONSHIP_USAGE: TokenUsage = { inputTokens: 2_000, outputTokens: 200 };
const SOURCE_CACHE_VERSION = "normalized-v1";
const SENSE_PROMPT_VERSION = "sense-v1";
const RELATIONSHIP_PROMPT_VERSION = "relationship-v1";

const nonEmpty = z.string().min(1);
const nullableText = z.string().nullable();
const usageSchema = z.object({
  inputTokens: z.number().int().nonnegative(),
  outputTokens: z.number().int().nonnegative(),
}).strict();
const dictionarySourceSchema = z.object({
  sourceId: nonEmpty,
  url: z.url().nullable(),
  retrievedAt: z.iso.datetime().nullable(),
  contentHash: nullableText,
}).strict();
const contentSourceSchema = z.object({
  sourceId: nonEmpty,
  externalId: nullableText,
  url: z.url().nullable(),
  retrievedAt: z.iso.datetime().nullable(),
  contentHash: nullableText,
}).strict();
const sourceMetadataSchema = z.object({
  entryId: z.string().optional(),
  url: z.url().nullable().optional(),
}).strict();
const wordDetailSchema = z.object({
  ipa: nullableText,
  audioUk: z.url().nullable(),
  audioUs: z.url().nullable(),
  audioAny: z.url().nullable(),
  sourceEntryId: z.string().optional(),
  sourceUrl: z.url().nullable().optional(),
  pronunciationSources: z.object({
    ipa: sourceMetadataSchema.optional(),
    audioUk: sourceMetadataSchema.optional(),
    audioUs: sourceMetadataSchema.optional(),
    audioAny: sourceMetadataSchema.optional(),
  }).strict().optional(),
  senses: z.array(z.object({
    partOfSpeech: z.string(),
    definition: z.string(),
    example: z.string().nullable(),
    sourceEntryId: z.string().optional(),
    sourceSenseId: z.string().optional(),
    sourceUrl: z.url().nullable().optional(),
  }).strict()),
  synonyms: z.array(z.string()),
}).strict();
const factualEvidenceSchema = z.object({
  provider: z.enum(["wordnet", "dictionaryapi"]),
  returnedLemma: nonEmpty,
  requestedPartOfSpeech: nonEmpty,
  detail: wordDetailSchema,
  source: dictionarySourceSchema,
}).strict().superRefine((value, context) => {
  if (value.provider !== value.source.sourceId) {
    context.addIssue({ code: "custom", message: "provider/source mismatch", path: ["source", "sourceId"] });
  }
});
const sourcedExampleSchema = z.object({
  id: nonEmpty,
  text: nonEmpty,
  language: z.literal("eng"),
  source: contentSourceSchema,
}).strict();
const eligibleExampleSchema = z.object({
  id: nonEmpty,
  text: nonEmpty,
  source: z.union([dictionarySourceSchema, contentSourceSchema]),
}).strict();
const eligibleSenseSchema = z.object({
  id: nonEmpty,
  partOfSpeech: nonEmpty,
  definition: nonEmpty,
  source: dictionarySourceSchema,
  examples: z.array(eligibleExampleSchema),
}).strict();
const senseResultSchema = z.object({
  eligibleSenses: z.array(eligibleSenseSchema),
  selectedSenseId: z.string().nullable(),
  selectedExampleId: z.string().nullable(),
  reason: VerificationReasonCodeSchema.nullable(),
  decisionSource: z.enum(["deterministic", "llm", "unavailable"]),
  usage: usageSchema,
}).strict();
const anchorDecisionSchema = z.object({
  coreLemma: z.string(),
  candidateType: z.literal("builds_on"),
  coreType: z.literal("advanced_form"),
  candidateGloss: z.string(),
  coreGloss: z.string(),
  decision: z.enum(["supported", "unsupported", "ambiguous"]),
  method: z.enum(["direct_lexical", "llm_consensus", "llm_disagreement", "unavailable"]),
  reason: VerificationReasonCodeSchema.nullable(),
}).strict();
const relationshipResultSchema = z.object({
  decisions: z.array(anchorDecisionSchema),
  hasSupportedAnchor: z.boolean(),
  usage: usageSchema,
}).strict();

const dictionaryEnvelopeSchema = z.object({ value: factualEvidenceSchema.nullable() }).strict();
const tatoebaEnvelopeSchema = z.object({ value: z.array(sourcedExampleSchema) }).strict();
const senseEnvelopeSchema = z.object({ value: senseResultSchema }).strict();
const relationshipEnvelopeSchema = z.object({ value: relationshipResultSchema }).strict();

function addUsage(left: TokenUsage, right: TokenUsage): TokenUsage {
  return {
    inputTokens: left.inputTokens + right.inputTokens,
    outputTokens: left.outputTokens + right.outputTokens,
  };
}

function emptyStats(): RunStats {
  return {
    cache: {
      wordnet: { hits: 0, misses: 0 },
      dictionaryapi: { hits: 0, misses: 0 },
      tatoeba: { hits: 0, misses: 0 },
      llm: { hits: 0, misses: 0 },
    },
    sourceRequests: 0,
    llmRequests: 0,
    tokenUsage: { ...ZERO_USAGE },
  };
}

function validateOptions(options: VerificationRunOptions): void {
  if (!Number.isInteger(options.limit) || options.limit < 0) throw new Error("limit must be a non-negative integer");
  if (!Number.isInteger(options.concurrency) || options.concurrency < 1 || options.concurrency > 5) {
    throw new Error("concurrency must be an integer from 1 to 5");
  }
  if (!Number.isInteger(options.maxSourceRequests) || options.maxSourceRequests < 0) {
    throw new Error("maxSourceRequests must be a non-negative integer");
  }
  if (!Number.isInteger(options.maxInputTokens) || options.maxInputTokens < 0) {
    throw new Error("maxInputTokens must be a non-negative integer");
  }
  if (!Number.isInteger(options.maxOutputTokens) || options.maxOutputTokens < 0) {
    throw new Error("maxOutputTokens must be a non-negative integer");
  }
}

function recordStateHash(record: VocabularyRecord): string {
  return `sha256:${createHash("sha256").update(JSON.stringify(record), "utf8").digest("hex")}`;
}

function batchFor(
  candidates: readonly VerificationCandidate[],
  before: readonly VocabularyRecord[],
  after: readonly VocabularyRecord[],
): VerificationBatchEntry[] {
  const beforeByLemma = new Map(before.map((record) => [record.lemma, record]));
  const afterByLemma = new Map(after.map((record) => [record.lemma, record]));
  return candidates.map((candidate) => ({
    lemma: candidate.record.lemma,
    anchors: candidate.anchors.map((anchor) => ({ ...anchor })),
    expectedRecords: [...new Set([
      candidate.record.lemma,
      ...candidate.anchors.map((anchor) => anchor.coreLemma),
    ])].sort().map((lemma) => {
      const beforeRecord = beforeByLemma.get(lemma);
      const afterRecord = afterByLemma.get(lemma);
      if (!beforeRecord || !afterRecord) throw new Error(`batch state record is missing: ${lemma}`);
      return {
        lemma,
        beforeHash: recordStateHash(beforeRecord),
        afterHash: recordStateHash(afterRecord),
      };
    }),
  }));
}

function hasPinnedConnection(
  record: VocabularyRecord,
  target: string,
  type: "builds_on" | "advanced_form",
  gloss: string,
): boolean {
  return record.connections.some((connection) =>
    connection.target === target
    && connection.type === type
    && connection.gloss === gloss
    && connection.status !== "hidden",
  );
}

function candidatesForRun(
  records: readonly VocabularyRecord[],
  limit: number,
  batch: readonly VerificationBatchEntry[] | undefined,
): VerificationCandidate[] {
  if (batch === undefined) return selectAdvancedVerificationCandidates(records, limit);
  if (batch.length > limit) throw new Error("pinned batch cannot exceed limit");

  const recordsByLemma = new Map(records.map((record) => [record.lemma, record]));
  const seenLemmas = new Set<string>();
  return batch.map((entry) => {
    if (seenLemmas.has(entry.lemma)) throw new Error(`duplicate pinned candidate: ${entry.lemma}`);
    seenLemmas.add(entry.lemma);
    const record = recordsByLemma.get(entry.lemma);
    if (!record || record.tier !== "advanced") {
      throw new Error(`pinned advanced candidate is missing: ${entry.lemma}`);
    }

    const expectedStateLemmas = [...new Set([
      entry.lemma,
      ...entry.anchors.map((anchor) => anchor.coreLemma),
    ])].sort();
    if (
      entry.expectedRecords.length !== expectedStateLemmas.length
      || entry.expectedRecords.some((state, index) => state.lemma !== expectedStateLemmas[index])
    ) {
      throw new Error(`pinned batch state is invalid for ${entry.lemma}`);
    }
    for (const state of entry.expectedRecords) {
      const current = recordsByLemma.get(state.lemma);
      const currentHash = current ? recordStateHash(current) : null;
      if (currentHash !== state.beforeHash && currentHash !== state.afterHash) {
        throw new Error(`pinned batch state is stale for ${state.lemma}`);
      }
    }

    const seenCores = new Set<string>();
    const anchors: ReciprocalCoreAnchor[] = entry.anchors.map((anchor) => {
      if (seenCores.has(anchor.coreLemma)) {
        throw new Error(`duplicate pinned core anchor for ${entry.lemma}: ${anchor.coreLemma}`);
      }
      seenCores.add(anchor.coreLemma);
      const core = recordsByLemma.get(anchor.coreLemma);
      if (
        !core
        || core.tier !== "core"
        || core.publicationStatus !== "published"
        || !hasPinnedConnection(record, core.lemma, "builds_on", anchor.candidateGloss)
        || !hasPinnedConnection(core, record.lemma, "advanced_form", anchor.coreGloss)
      ) {
        throw new Error(`pinned reciprocal anchor is stale: ${entry.lemma} -> ${anchor.coreLemma}`);
      }
      return { ...anchor };
    });
    const incomingPublishedCount = [...recordsByLemma.values()].reduce((count, core) =>
      count + (core.tier === "core" && core.publicationStatus === "published"
        ? core.connections.filter((connection) =>
          connection.target === record.lemma && connection.status === "published").length
        : 0), 0);
    const verificationRecord: VocabularyRecord = {
      ...record,
      publicationStatus: "hidden",
      connections: record.connections.map((connection) =>
        anchors.some((anchor) =>
          connection.target === anchor.coreLemma
          && connection.type === anchor.candidateType
          && connection.gloss === anchor.candidateGloss)
          ? { ...connection, status: "published" }
          : connection),
    };
    return {
      record: verificationRecord,
      anchors,
      incomingPublishedCount,
      distinctPublishedCoreAnchors: anchors.length,
    };
  });
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (!signal?.aborted) return;
  const error = new Error("Vocabulary verification aborted");
  error.name = "AbortError";
  throw error;
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}

function providerKey(provider: ProviderName, candidate: VerificationCandidate): string {
  return verificationCacheKey({
    provider,
    version: SOURCE_CACHE_VERSION,
    request: {
      lemma: candidate.record.lemma,
      partOfSpeech: candidate.record.partOfSpeech,
      ...(provider === "tatoeba" ? { forms: candidate.record.forms } : {}),
    },
  });
}

async function cachedDictionaryEvidence(
  provider: "wordnet" | "dictionaryapi",
  candidate: VerificationCandidate,
  dependencies: VerificationDependencies,
  sourceBudget: SourceRequestBudget,
  stats: RunStats,
  options: VerificationRunOptions,
): Promise<FactualDictionaryEvidence | null> {
  const key = providerKey(provider, candidate);
  const cached = await dependencies.cache.get(provider, key, dictionaryEnvelopeSchema);
  if (cached !== null) {
    stats.cache[provider].hits += 1;
    return cached.value;
  }
  stats.cache[provider].misses += 1;
  throwIfAborted(options.signal);

  if (provider === "dictionaryapi") {
    if (!sourceBudget.reserve(key)) throw new SourceBudgetExhaustedError("Source request budget exhausted");
    stats.sourceRequests += 1;
  }
  const value = provider === "wordnet"
    ? await dependencies.getWordNet(candidate)
    : await dependencies.getDictionary(candidate);
  await dependencies.cache.set(provider, key, { value }, dictionaryEnvelopeSchema);
  return value;
}

async function cachedTatoebaExamples(
  candidate: VerificationCandidate,
  dependencies: VerificationDependencies,
  sourceBudget: SourceRequestBudget,
  stats: RunStats,
  options: VerificationRunOptions,
): Promise<SourcedExampleEvidence[]> {
  const provider = "tatoeba" as const;
  const key = providerKey(provider, candidate);
  const cached = await dependencies.cache.get(provider, key, tatoebaEnvelopeSchema);
  if (cached !== null) {
    stats.cache.tatoeba.hits += 1;
    return cached.value;
  }
  stats.cache.tatoeba.misses += 1;
  throwIfAborted(options.signal);
  if (!sourceBudget.reserve(key)) throw new SourceBudgetExhaustedError("Source request budget exhausted");
  stats.sourceRequests += 1;
  const value = await dependencies.getTatoeba(candidate);
  await dependencies.cache.set(provider, key, { value }, tatoebaEnvelopeSchema);
  return value;
}

function llmKey(
  task: "sense" | "relationship",
  request: unknown,
  dependencies: VerificationDependencies,
): string {
  return verificationCacheKey({
    provider: "llm",
    version: "decision-v1",
    model: dependencies.modelId ?? "default",
    promptVersion: task === "sense" ? SENSE_PROMPT_VERSION : RELATIONSHIP_PROMPT_VERSION,
    request: { task, evidence: request },
  });
}

function withZeroUsage(result: SenseVerificationResult): SenseVerificationResult;
function withZeroUsage(result: RelationshipVerificationResult): RelationshipVerificationResult;
function withZeroUsage(
  result: SenseVerificationResult | RelationshipVerificationResult,
): SenseVerificationResult | RelationshipVerificationResult {
  return { ...result, usage: { ...ZERO_USAGE } };
}

async function cachedSenseVerification(
  candidate: VerificationCandidate,
  dictionaryEvidence: FactualDictionaryEvidence[],
  tatoebaExamples: SourcedExampleEvidence[],
  dependencies: VerificationDependencies,
  tokenBudget: TokenBudget,
  stats: RunStats,
  options: VerificationRunOptions,
): Promise<SenseVerificationResult> {
  const input = {
    candidate: candidate.record,
    dictionaryEvidence,
    tatoebaExamples,
    tokenBudget,
    requestId: `sense:${candidate.record.lemma}`,
    estimatedUsage: dependencies.estimatedSenseUsage ?? DEFAULT_SENSE_USAGE,
  };
  const deterministic = await verifyCandidateSense(input, null);
  if (deterministic.reason !== "judge_unavailable") return deterministic;

  const key = llmKey("sense", {
    candidate: {
      lemma: candidate.record.lemma,
      partOfSpeech: candidate.record.partOfSpeech,
      forms: candidate.record.forms,
    },
    dictionaryEvidence,
    tatoebaExamples,
  }, dependencies);
  const cached = await dependencies.cache.get("llm", key, senseEnvelopeSchema);
  if (cached !== null) {
    stats.cache.llm.hits += 1;
    return withZeroUsage(cached.value);
  }
  stats.cache.llm.misses += 1;
  if (!dependencies.judgeSense) return deterministic;
  throwIfAborted(options.signal);

  const countedJudge: SenseJudge = async (request) => {
    throwIfAborted(options.signal);
    stats.llmRequests += 1;
    return dependencies.judgeSense!(request);
  };
  const result = await verifyCandidateSense(input, countedJudge);
  if (result.decisionSource === "llm" && result.reason !== "judge_unavailable" && result.reason !== "budget_exhausted") {
    await dependencies.cache.set("llm", key, { value: result }, senseEnvelopeSchema);
  }
  return result;
}

async function cachedRelationshipVerification(
  candidate: VerificationCandidate,
  selectedSense: SenseVerificationResult["eligibleSenses"][number],
  dictionaryEvidence: FactualDictionaryEvidence[],
  records: VocabularyRecord[],
  dependencies: VerificationDependencies,
  tokenBudget: TokenBudget,
  stats: RunStats,
  options: VerificationRunOptions,
): Promise<RelationshipVerificationResult> {
  const coreRecords = candidate.anchors.flatMap((anchor) => {
    const core = records.find((record) => record.lemma === anchor.coreLemma);
    if (!core) return [];
    return [{
      ...core,
      connections: core.connections.map((connection) =>
        connection.target === candidate.record.lemma
        && connection.type === anchor.coreType
        && connection.gloss === anchor.coreGloss
          ? { ...connection, status: "published" as const }
          : connection),
    }];
  });
  const input = {
    candidate: candidate.record,
    selectedSense,
    anchors: candidate.anchors,
    factualDictionaryEvidence: dictionaryEvidence,
    coreRecords,
    tokenBudget,
    requestId: `relationship:${candidate.record.lemma}`,
    estimatedUsage: dependencies.estimatedRelationshipUsage ?? DEFAULT_RELATIONSHIP_USAGE,
  };
  const deterministic = await verifyCandidateRelationships(input, null);
  if (!deterministic.decisions.some((decision) => decision.reason === "judge_unavailable")) {
    return deterministic;
  }

  const key = llmKey("relationship", {
    candidate: candidate.record.lemma,
    selectedSense,
    anchors: candidate.anchors,
    dictionaryEvidence,
    coreRecords,
  }, dependencies);
  const cached = await dependencies.cache.get("llm", key, relationshipEnvelopeSchema);
  if (cached !== null) {
    stats.cache.llm.hits += 1;
    return withZeroUsage(cached.value);
  }
  stats.cache.llm.misses += 1;
  if (!dependencies.judgeRelationship) return deterministic;
  throwIfAborted(options.signal);

  const countedJudge: RelationshipJudge = async (request) => {
    throwIfAborted(options.signal);
    stats.llmRequests += 1;
    return dependencies.judgeRelationship!(request);
  };
  const result = await verifyCandidateRelationships(input, countedJudge);
  if (
    result.decisions.some((decision) => decision.method === "llm_consensus" || decision.method === "llm_disagreement")
    && !result.decisions.some((decision) => decision.reason === "judge_unavailable" || decision.reason === "budget_exhausted")
  ) {
    await dependencies.cache.set("llm", key, { value: result }, relationshipEnvelopeSchema);
  }
  return result;
}

function ambiguousRelationships(
  candidate: VerificationCandidate,
  reason: VerificationReasonCode,
): AnchorDecision[] {
  return candidate.anchors.map((anchor) => ({
    ...anchor,
    decision: "ambiguous",
    method: "unavailable",
    reason,
  }));
}

function failedOutcome(
  candidate: VerificationCandidate,
  dictionaryEvidence: FactualDictionaryEvidence[],
  reason: VerificationReasonCode,
): CandidateVerificationOutcome {
  return {
    candidateLemma: candidate.record.lemma,
    dictionaryEvidence,
    selectedExample: null,
    selectedSenseId: null,
    relationships: ambiguousRelationships(candidate, reason),
    reason,
  };
}

function relationshipReason(result: RelationshipVerificationResult): VerificationReasonCode {
  if (result.hasSupportedAnchor) return "published";
  if (result.decisions.length === 0) return "no_reciprocal_anchor";
  const reasons = result.decisions.flatMap((decision) => decision.reason ? [decision.reason] : []);
  for (const priority of [
    "budget_exhausted",
    "judge_unavailable",
    "no_factual_sense",
    "no_reciprocal_anchor",
    "relationship_ambiguous",
    "relationship_unsupported",
  ] as const) {
    if (reasons.includes(priority)) return priority;
  }
  return result.decisions.some((decision) => decision.decision === "unsupported")
    ? "relationship_unsupported"
    : "relationship_ambiguous";
}

async function processCandidate(
  candidate: VerificationCandidate,
  records: VocabularyRecord[],
  dependencies: VerificationDependencies,
  sourceBudget: SourceRequestBudget,
  tokenBudget: TokenBudget,
  stats: RunStats,
  options: VerificationRunOptions,
): Promise<CandidateProcessResult> {
  const dictionaryEvidence: FactualDictionaryEvidence[] = [];
  let tatoebaExamples: SourcedExampleEvidence[] = [];
  try {
    const wordnet = await cachedDictionaryEvidence(
      "wordnet", candidate, dependencies, sourceBudget, stats, options,
    );
    if (wordnet) dictionaryEvidence.push(wordnet);
    const dictionary = await cachedDictionaryEvidence(
      "dictionaryapi", candidate, dependencies, sourceBudget, stats, options,
    );
    if (dictionary) dictionaryEvidence.push(dictionary);
    tatoebaExamples = await cachedTatoebaExamples(candidate, dependencies, sourceBudget, stats, options);
  } catch (error) {
    if (isAbortError(error)) throw error;
    const exhausted = error instanceof SourceBudgetExhaustedError;
    const reason = exhausted ? "budget_exhausted" : "provider_failed";
    return { outcome: failedOutcome(candidate, dictionaryEvidence, reason), stopScheduling: exhausted };
  }

  const sense = await cachedSenseVerification(
    candidate,
    dictionaryEvidence,
    tatoebaExamples,
    dependencies,
    tokenBudget,
    stats,
    options,
  );
  stats.tokenUsage = addUsage(stats.tokenUsage, sense.usage);
  if (sense.reason !== null || sense.selectedSenseId === null) {
    const reason = sense.reason ?? "sense_ambiguous";
    return {
      outcome: failedOutcome(candidate, dictionaryEvidence, reason),
      stopScheduling: reason === "budget_exhausted" || (
        tokenBudget.exhausted()
        && (sense.usage.inputTokens > 0 || sense.usage.outputTokens > 0)
      ),
    };
  }

  const selectedSense = sense.eligibleSenses.find((value) => value.id === sense.selectedSenseId);
  if (!selectedSense) {
    return { outcome: failedOutcome(candidate, dictionaryEvidence, "sense_ambiguous"), stopScheduling: false };
  }
  const selectedExample = sense.selectedExampleId === null
    ? null
    : tatoebaExamples.find((example) => example.id === sense.selectedExampleId) ?? null;
  const relationships = await cachedRelationshipVerification(
    candidate,
    selectedSense,
    dictionaryEvidence,
    records,
    dependencies,
    tokenBudget,
    stats,
    options,
  );
  stats.tokenUsage = addUsage(stats.tokenUsage, relationships.usage);
  const reason = relationshipReason(relationships);
  const hitBudget = relationships.decisions.some((decision) => decision.reason === "budget_exhausted");
  const usedTokens = sense.usage.inputTokens > 0
    || sense.usage.outputTokens > 0
    || relationships.usage.inputTokens > 0
    || relationships.usage.outputTokens > 0;

  return {
    outcome: {
      candidateLemma: candidate.record.lemma,
      dictionaryEvidence,
      selectedExample,
      selectedSenseId: sense.selectedSenseId,
      relationships: relationships.decisions,
      reason,
    },
    stopScheduling: hitBudget || (tokenBudget.exhausted() && usedTokens),
  };
}

function findingIdentity(finding: Finding): string {
  return JSON.stringify([finding.level, finding.lemma, finding.message]);
}

function assertNoRegressions(
  baselineLint: Finding[],
  proposedLint: Finding[],
  baselineAudit: DictionaryQualityReport,
  proposedAudit: DictionaryQualityReport,
): void {
  const baselineLintIds = new Set(baselineLint.map(findingIdentity));
  const newLint = proposedLint.filter((finding) => !baselineLintIds.has(findingIdentity(finding)));
  if (newLint.length > 0) {
    throw new Error(`New lint identities introduced: ${newLint.map(findingIdentity).join(", ")}`);
  }
  const strictIdentities = strictViolationIdentityRegressions(
    proposedAudit.strictViolations,
    baselineAudit.strictViolations,
  );
  const strictCounts = strictViolationRegressions(
    proposedAudit.total.strict,
    baselineAudit.total.strict,
  );
  if (strictIdentities.length > 0 || strictCounts.length > 0) {
    throw new Error(`New dictionary audit violations introduced: ${[
      ...strictIdentities,
      ...strictCounts,
    ].join(", ")}`);
  }
}

function classifyOutcomes(outcomes: readonly CandidateVerificationOutcome[]) {
  const published = outcomes.filter((outcome) => outcome.reason === "published").length;
  const unsupported = outcomes.filter((outcome) => outcome.reason === "relationship_unsupported").length;
  const failed = outcomes.filter((outcome) => outcome.reason === "provider_failed").length;
  return {
    published,
    unsupported,
    failed,
    ambiguous: outcomes.length - published - unsupported - failed,
  };
}

export async function runVerificationBatch(
  options: VerificationRunOptions,
  dependencies: VerificationDependencies,
): Promise<VerificationRunResult> {
  validateOptions(options);
  throwIfAborted(options.signal);

  const loaded = await dependencies.loadRecords();
  const records = loaded.map((record) => VocabularyRecordSchema.parse(record));
  const lintRecords = dependencies.lintRecords ?? lintVocabularyRecords;
  const auditRecords = dependencies.auditRecords ?? auditDictionaryRecords;
  const baselineLint = lintRecords(records);
  const baselineAudit = auditRecords(records);
  const pinnedBatch = options.batch === undefined
    ? undefined
    : z.array(VerificationBatchEntrySchema).parse(options.batch);
  const candidates = candidatesForRun(records, options.limit, pinnedBatch);
  const sourceBudget = new SourceRequestBudget(options.maxSourceRequests);
  const tokenBudget = new TokenBudget({
    maxInputTokens: options.maxInputTokens,
    maxOutputTokens: options.maxOutputTokens,
  });
  const stats = emptyStats();
  const completed: Array<CandidateVerificationOutcome | undefined> = new Array(candidates.length);
  let cursor = 0;
  let stopScheduling = false;

  const worker = async () => {
    try {
      while (true) {
        if (stopScheduling) return;
        const index = cursor;
        if (index >= candidates.length) return;
        cursor += 1;
        const candidate = candidates[index]!;
        const result = await processCandidate(
          candidate,
          records,
          dependencies,
          sourceBudget,
          tokenBudget,
          stats,
          options,
        );
        completed[index] = result.outcome;
        if (result.stopScheduling) stopScheduling = true;
      }
    } catch (error) {
      stopScheduling = true;
      throw error;
    }
  };

  const workerResults = await Promise.allSettled(Array.from(
    { length: Math.min(options.concurrency, candidates.length) },
    () => worker(),
  ));
  const failedWorker = workerResults.find(
    (result): result is PromiseRejectedResult => result.status === "rejected",
  );
  if (failedWorker) throw failedWorker.reason;
  throwIfAborted(options.signal);
  const outcomes = completed.filter((value): value is CandidateVerificationOutcome => value !== undefined);
  const mutation = applyVerificationOutcomes(records, outcomes);
  mutation.snapshot.forEach((record) => VocabularyRecordSchema.parse(record));
  const proposedLint = lintRecords(mutation.snapshot);
  const proposedAudit = auditRecords(mutation.snapshot);
  assertNoRegressions(baselineLint, proposedLint, baselineAudit, proposedAudit);
  const batch = pinnedBatch ?? batchFor(candidates, records, mutation.snapshot);

  let changedShards: string[] = [];
  if (options.write && mutation.updates.length > 0) {
    throwIfAborted(options.signal);
    changedShards = normalizeChangedShards(await dependencies.persist(mutation.updates));
    if (changedShards.length > 0) await dependencies.buildGraphs();
    throwIfAborted(options.signal);
  }

  const candidateCounts = classifyOutcomes(outcomes);
  const decisions = outcomes.flatMap((outcome) => outcome.relationships);
  const report = createVerificationReport({
    version: 1,
    mode: options.write ? "write" : "dry-run",
    selected: candidates.length,
    attempted: outcomes.length,
    sourceBacked: outcomes.filter((outcome) => outcome.dictionaryEvidence.length > 0).length,
    ...candidateCounts,
    relationships: {
      accepted: decisions.filter((decision) => decision.decision === "supported").length,
      rejected: decisions.filter((decision) => decision.decision === "unsupported").length,
      ambiguous: decisions.filter((decision) => decision.decision === "ambiguous").length,
      downgraded: mutation.downgradedRelationshipCount,
    },
    cache: stats.cache,
    requests: { source: stats.sourceRequests, llm: stats.llmRequests },
    tokenUsage: stats.tokenUsage,
    changedShards,
    entries: outcomes.map((outcome) => ({ lemma: outcome.candidateLemma, reason: outcome.reason })),
    remaining: {
      hiddenAdvanced: mutation.snapshot.filter((record) =>
        record.tier === "advanced" && record.publicationStatus === "hidden").length,
      strictViolations: proposedAudit.total.strict,
    },
  });

  return { report, batch, outcomes, mutation };
}
