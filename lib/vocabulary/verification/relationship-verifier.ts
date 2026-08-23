import { createHash } from "node:crypto";

import { z } from "zod";

import { TokenBudget, type TokenUsage } from "../enrichment/budget";
import type { VocabularyRecord, VocabularySense } from "../schema";
import { isFactualSourceId, sourceRefsForSense } from "../source-evidence";
import { RelationshipDecisionSchema } from "./decision-schema";
import type { FactualDictionaryEvidence } from "./provider-types";
import { eligibleFactualSenses, type EligibleFactualSense } from "./sense-verifier";
import type { ReciprocalCoreAnchor, VerificationReasonCode } from "./types";

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

export type RelationshipJudgeRequest = {
  candidateSenseId: string;
  coreLemma: string;
  relationship: {
    candidateType: "builds_on";
    coreType: "advanced_form";
    candidateGloss: string;
    coreGloss: string;
  };
  senses: Array<{
    role: "candidate" | "core";
    lemma: string;
    id: string;
    partOfSpeech: string;
    definition: string;
  }>;
};

export type RelationshipJudge = (
  request: RelationshipJudgeRequest,
) => Promise<{ decision: unknown; usage: TokenUsage }>;

export type RelationshipVerificationInput = {
  candidate: VocabularyRecord;
  selectedSense: EligibleFactualSense;
  anchors: readonly ReciprocalCoreAnchor[];
  factualDictionaryEvidence: readonly FactualDictionaryEvidence[];
  coreRecords: readonly VocabularyRecord[];
  tokenBudget: TokenBudget;
  requestId: string;
  estimatedUsage: TokenUsage;
};

type JudgeOutcome = {
  available: boolean;
  decision: unknown;
  usage: TokenUsage;
};

const ZERO_USAGE: TokenUsage = { inputTokens: 0, outputTokens: 0 };
const CORE_DEFINITION_SOURCE_IDS = new Set(["curated", "wordnet", "dictionaryapi"]);
const SHA256_CONTENT_HASH = /^sha256:[0-9a-f]{64}$/u;
const ADAPTER_ISO_TIMESTAMP_SCHEMA = z.iso.datetime();
const INVALID_RECIPROCAL_ANCHOR: ReciprocalCoreAnchor = {
  coreLemma: "",
  candidateType: "builds_on",
  coreType: "advanced_form",
  candidateGloss: "",
  coreGloss: "",
};

function normalizeComparisonKey(value: string): string {
  return value.normalize("NFC").replace(/_/g, " ").trim().toLocaleLowerCase("en-US").replace(/\s+/gu, " ");
}

function validUsage(usage: TokenUsage): boolean {
  return Number.isFinite(usage.inputTokens)
    && Number.isFinite(usage.outputTokens)
    && usage.inputTokens >= 0
    && usage.outputTokens >= 0;
}

function plusUsage(left: TokenUsage, right: TokenUsage): TokenUsage {
  return {
    inputTokens: left.inputTokens + right.inputTokens,
    outputTokens: left.outputTokens + right.outputTokens,
  };
}

function nonEmptyGloss(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function nullableString(value: unknown): boolean {
  return value === null || typeof value === "string";
}

function usableDictionarySenseShape(value: unknown): boolean {
  if (!isRecord(value)) return false;
  return typeof value.partOfSpeech === "string"
    && typeof value.definition === "string"
    && nullableString(value.example)
    && (value.sourceEntryId === undefined || typeof value.sourceEntryId === "string")
    && (value.sourceSenseId === undefined || typeof value.sourceSenseId === "string")
    && (value.sourceUrl === undefined || nullableString(value.sourceUrl));
}

function usableWordDetailShape(value: unknown): boolean {
  if (!isRecord(value)) return false;
  return nullableString(value.ipa)
    && nullableString(value.audioUk)
    && nullableString(value.audioUs)
    && nullableString(value.audioAny)
    && Array.isArray(value.senses)
    && value.senses.every(usableDictionarySenseShape)
    && Array.isArray(value.synonyms)
    && value.synonyms.every((synonym) => typeof synonym === "string")
    && (value.sourceEntryId === undefined || typeof value.sourceEntryId === "string")
    && (value.sourceUrl === undefined || nullableString(value.sourceUrl));
}

function usableDictionarySourceShape(value: unknown): boolean {
  if (!isRecord(value)) return false;
  return typeof value.sourceId === "string"
    && nullableString(value.url)
    && nullableString(value.retrievedAt)
    && typeof value.contentHash === "string";
}

function hashJson(value: unknown): string | null {
  try {
    const serialized = JSON.stringify(value);
    if (serialized === undefined) return null;
    return `sha256:${createHash("sha256").update(serialized, "utf8").digest("hex")}`;
  } catch {
    return null;
  }
}

function adapterIsoTimestamp(value: unknown): value is string {
  return ADAPTER_ISO_TIMESTAMP_SCHEMA.safeParse(value).success;
}

function dictionaryRequestUrl(lemma: string): string {
  return `https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(lemma)}`;
}

/**
 * Replays each adapter's serialization and metadata contract. This detects
 * malformed or cross-provider values; the embedded hash is not authentication.
 */
function hasAdapterPayloadIntegrity(
  candidate: VocabularyRecord,
  evidence: FactualDictionaryEvidence,
): boolean {
  const contentHash = evidence.source.contentHash;
  if (typeof contentHash !== "string" || !SHA256_CONTENT_HASH.test(contentHash)) return false;

  const expectedHash = evidence.provider === "wordnet"
    ? hashJson(evidence.detail)
    : hashJson({
      returnedLemma: evidence.returnedLemma,
      requestedPartOfSpeech: evidence.requestedPartOfSpeech,
      detail: evidence.detail,
    });
  if (contentHash !== expectedHash) return false;

  if (evidence.provider === "wordnet") {
    return evidence.source.url === null
      && (evidence.source.retrievedAt === null || adapterIsoTimestamp(evidence.source.retrievedAt));
  }
  return evidence.source.url === dictionaryRequestUrl(candidate.lemma)
    && adapterIsoTimestamp(evidence.source.retrievedAt);
}

function everyReturnedSenseIsEligible(
  candidate: VocabularyRecord,
  evidence: FactualDictionaryEvidence,
): boolean {
  if (evidence.detail.senses.length === 0) return false;
  const eligibleSenses = eligibleFactualSenses(candidate, [evidence]);
  return evidence.detail.senses.every((sense) =>
    sense.partOfSpeech === candidate.partOfSpeech
    && sense.partOfSpeech === evidence.requestedPartOfSpeech
    && eligibleSenses.some((eligible) =>
      eligible.partOfSpeech === sense.partOfSpeech
      && eligible.definition === sense.definition,
    ),
  );
}

function trustedCandidateEvidence(
  candidate: VocabularyRecord,
  values: readonly FactualDictionaryEvidence[],
): FactualDictionaryEvidence[] {
  const candidateLemma = normalizeComparisonKey(candidate.lemma);
  return values.filter((value): value is FactualDictionaryEvidence => {
    try {
      if (!isRecord(value)) return false;
      const provider = value.provider;
      if (
        (provider !== "wordnet" && provider !== "dictionaryapi")
        || !usableDictionarySourceShape(value.source)
        || value.source.sourceId !== provider
        || typeof value.returnedLemma !== "string"
        || normalizeComparisonKey(value.returnedLemma) !== candidateLemma
        || value.requestedPartOfSpeech !== candidate.partOfSpeech
        || !usableWordDetailShape(value.detail)
        || !hasAdapterPayloadIntegrity(candidate, value as FactualDictionaryEvidence)
      ) return false;

      const evidence = value as FactualDictionaryEvidence;
      return everyReturnedSenseIsEligible(candidate, evidence);
    } catch {
      return false;
    }
  });
}

function usableSelectedSenseShape(value: unknown): value is EligibleFactualSense {
  if (!isRecord(value)) return false;
  return typeof value.id === "string"
    && typeof value.partOfSpeech === "string"
    && typeof value.definition === "string"
    && usableDictionarySourceShape(value.source)
    && Array.isArray(value.examples);
}

function sameSelectedSource(
  left: EligibleFactualSense["source"],
  right: EligibleFactualSense["source"],
): boolean {
  return left.sourceId === right.sourceId
    && left.url === right.url
    && left.retrievedAt === right.retrievedAt
    && left.contentHash === right.contentHash;
}

function selectedSenseIsCanonical(
  candidate: VocabularyRecord,
  selectedSense: unknown,
  evidence: readonly FactualDictionaryEvidence[],
): boolean {
  try {
    if (!usableSelectedSenseShape(selectedSense)) return false;
    return eligibleFactualSenses(candidate, evidence).some((eligible) =>
      eligible.id === selectedSense.id
      && eligible.partOfSpeech === selectedSense.partOfSpeech
      && eligible.definition === selectedSense.definition
      && sameSelectedSource(eligible.source, selectedSense.source),
    );
  } catch {
    return false;
  }
}

function factualSynonymKeys(evidence: readonly FactualDictionaryEvidence[]): Set<string> {
  const keys = new Set<string>();
  for (const item of evidence) {
    for (const synonym of item.detail.synonyms) {
      const key = normalizeComparisonKey(synonym);
      if (key) keys.add(key);
    }
  }
  return keys;
}

function publishedFactualCoreSenses(core: VocabularyRecord): VocabularySense[] {
  return core.senses.filter((sense) => {
    if (sense.status !== "published") return false;
    return sourceRefsForSense(sense).some((source) => {
      try {
        return isFactualSourceId(source.sourceId) && CORE_DEFINITION_SOURCE_IDS.has(source.sourceId);
      } catch {
        return false;
      }
    });
  });
}

function runtimeAnchor(value: unknown): { anchor: ReciprocalCoreAnchor; valid: boolean } {
  try {
    if (!isRecord(value)) return { anchor: INVALID_RECIPROCAL_ANCHOR, valid: false };
    const coreLemma = value.coreLemma;
    const candidateType = value.candidateType;
    const coreType = value.coreType;
    const candidateGloss = value.candidateGloss;
    const coreGloss = value.coreGloss;
    const valid = !(
      typeof coreLemma !== "string"
      || candidateType !== "builds_on"
      || coreType !== "advanced_form"
      || typeof candidateGloss !== "string"
      || typeof coreGloss !== "string"
    );
    return {
      anchor: {
        coreLemma: typeof coreLemma === "string" ? coreLemma : "",
        candidateType: "builds_on",
        coreType: "advanced_form",
        candidateGloss: typeof candidateGloss === "string" ? candidateGloss : "",
        coreGloss: typeof coreGloss === "string" ? coreGloss : "",
      },
      valid,
    };
  } catch {
    return { anchor: INVALID_RECIPROCAL_ANCHOR, valid: false };
  }
}

function coreForAnchor(
  input: RelationshipVerificationInput,
  anchor: ReciprocalCoreAnchor,
): { core: VocabularyRecord; senses: VocabularySense[] } | null {
  if (
    input.candidate.tier !== "advanced"
    || input.candidate.publicationStatus !== "hidden"
    || anchor.candidateType !== "builds_on"
    || anchor.coreType !== "advanced_form"
    || !nonEmptyGloss(anchor.candidateGloss)
    || !nonEmptyGloss(anchor.coreGloss)
  ) return null;

  const core = input.coreRecords.find((record) => record.lemma === anchor.coreLemma);
  if (!core || core.tier !== "core" || core.publicationStatus !== "published") return null;

  const candidateConnection = input.candidate.connections.some((connection) =>
    connection.target === core.lemma
    && connection.type === "builds_on"
    && connection.status === "published"
    && connection.gloss === anchor.candidateGloss,
  );
  const coreConnection = core.connections.some((connection) =>
    connection.target === input.candidate.lemma
    && connection.type === "advanced_form"
    && connection.status === "published"
    && connection.gloss === anchor.coreGloss,
  );
  if (!candidateConnection || !coreConnection) return null;

  return { core, senses: publishedFactualCoreSenses(core) };
}

function decision(
  anchor: ReciprocalCoreAnchor,
  value: AnchorDecision["decision"],
  method: AnchorDecision["method"],
  reason: VerificationReasonCode | null,
): AnchorDecision {
  return { ...anchor, decision: value, method, reason };
}

function requestFor(
  input: RelationshipVerificationInput,
  anchor: ReciprocalCoreAnchor,
  core: VocabularyRecord,
  coreSenses: readonly VocabularySense[],
  coreFirst: boolean,
): RelationshipJudgeRequest {
  const candidateEvidence: RelationshipJudgeRequest["senses"] = [{
    role: "candidate",
    lemma: input.candidate.lemma,
    id: input.selectedSense.id,
    partOfSpeech: input.selectedSense.partOfSpeech,
    definition: input.selectedSense.definition,
  }];
  const coreEvidence: RelationshipJudgeRequest["senses"] = coreSenses.map((sense) => ({
    role: "core",
    lemma: core.lemma,
    id: sense.id,
    partOfSpeech: sense.partOfSpeech,
    definition: sense.definition,
  }));

  return {
    candidateSenseId: input.selectedSense.id,
    coreLemma: anchor.coreLemma,
    relationship: {
      candidateType: anchor.candidateType,
      coreType: anchor.coreType,
      candidateGloss: anchor.candidateGloss,
      coreGloss: anchor.coreGloss,
    },
    senses: coreFirst ? [...coreEvidence, ...candidateEvidence] : [...candidateEvidence, ...coreEvidence],
  };
}

function matchesRequest(
  value: unknown,
  request: RelationshipJudgeRequest,
): "supported" | "unsupported" | null {
  const parsed = RelationshipDecisionSchema.safeParse(value);
  if (
    !parsed.success
    || parsed.data.candidateSenseId !== request.candidateSenseId
    || parsed.data.coreLemma !== request.coreLemma
  ) return null;
  return parsed.data.decision === "supported" || parsed.data.decision === "unsupported"
    ? parsed.data.decision
    : null;
}

function canReserveTwo(input: RelationshipVerificationInput): boolean {
  if (!validUsage(input.estimatedUsage)) return false;
  const remaining = input.tokenBudget.remaining();
  return input.estimatedUsage.inputTokens * 2 <= remaining.inputTokens
    && input.estimatedUsage.outputTokens * 2 <= remaining.outputTokens;
}

async function callJudge(
  judge: RelationshipJudge,
  request: RelationshipJudgeRequest,
  tokenBudget: TokenBudget,
  requestId: string,
  estimatedUsage: TokenUsage,
): Promise<JudgeOutcome> {
  try {
    const judged = await judge(request);
    if (!validUsage(judged.usage)) {
      tokenBudget.recordActual(requestId, estimatedUsage);
      return { available: true, decision: null, usage: estimatedUsage };
    }
    tokenBudget.recordActual(requestId, judged.usage);
    return { available: true, decision: judged.decision, usage: judged.usage };
  } catch {
    tokenBudget.recordActual(requestId, estimatedUsage);
    return { available: false, decision: null, usage: estimatedUsage };
  }
}

async function verifyAnchor(
  input: RelationshipVerificationInput,
  anchor: ReciprocalCoreAnchor,
  index: number,
  judge: RelationshipJudge | null,
): Promise<{ decision: AnchorDecision; usage: TokenUsage }> {
  const resolved = coreForAnchor(input, anchor);
  if (!resolved) {
    return { decision: decision(anchor, "ambiguous", "unavailable", "no_reciprocal_anchor"), usage: ZERO_USAGE };
  }
  const trustedEvidence = trustedCandidateEvidence(input.candidate, input.factualDictionaryEvidence);
  if (
    !selectedSenseIsCanonical(input.candidate, input.selectedSense, trustedEvidence)
    || resolved.senses.length === 0
  ) {
    return { decision: decision(anchor, "ambiguous", "unavailable", "no_factual_sense"), usage: ZERO_USAGE };
  }

  const synonymKeys = factualSynonymKeys(trustedEvidence);
  if (synonymKeys.has(normalizeComparisonKey(anchor.coreLemma))) {
    return { decision: decision(anchor, "supported", "direct_lexical", null), usage: ZERO_USAGE };
  }

  if (!judge) {
    return { decision: decision(anchor, "ambiguous", "unavailable", "judge_unavailable"), usage: ZERO_USAGE };
  }
  if (!canReserveTwo(input)) {
    return { decision: decision(anchor, "ambiguous", "unavailable", "budget_exhausted"), usage: ZERO_USAGE };
  }

  const baseRequestId = `${input.requestId}:relationship:${index}:${anchor.coreLemma}`;
  const candidateFirstId = input.tokenBudget.reserveFresh(
    `${baseRequestId}:candidate-first`,
    input.estimatedUsage,
  );
  const coreFirstId = input.tokenBudget.reserveFresh(
    `${baseRequestId}:core-first`,
    input.estimatedUsage,
  );
  if (!candidateFirstId || !coreFirstId) {
    return { decision: decision(anchor, "ambiguous", "unavailable", "budget_exhausted"), usage: ZERO_USAGE };
  }

  const candidateFirst = await callJudge(
    judge,
    requestFor(input, anchor, resolved.core, resolved.senses, false),
    input.tokenBudget,
    candidateFirstId,
    input.estimatedUsage,
  );
  if (!candidateFirst.available) {
    input.tokenBudget.recordActual(coreFirstId, input.estimatedUsage);
    return {
      decision: decision(anchor, "ambiguous", "unavailable", "judge_unavailable"),
      usage: plusUsage(candidateFirst.usage, input.estimatedUsage),
    };
  }

  const coreFirst = await callJudge(
    judge,
    requestFor(input, anchor, resolved.core, resolved.senses, true),
    input.tokenBudget,
    coreFirstId,
    input.estimatedUsage,
  );
  const usage = plusUsage(candidateFirst.usage, coreFirst.usage);
  if (!coreFirst.available) {
    return { decision: decision(anchor, "ambiguous", "unavailable", "judge_unavailable"), usage };
  }

  const firstDecision = matchesRequest(candidateFirst.decision, requestFor(input, anchor, resolved.core, resolved.senses, false));
  const secondDecision = matchesRequest(coreFirst.decision, requestFor(input, anchor, resolved.core, resolved.senses, true));
  if (firstDecision === "supported" && secondDecision === "supported") {
    return { decision: decision(anchor, "supported", "llm_consensus", null), usage };
  }
  if (firstDecision === "unsupported" && secondDecision === "unsupported") {
    return { decision: decision(anchor, "unsupported", "llm_consensus", "relationship_unsupported"), usage };
  }
  return { decision: decision(anchor, "ambiguous", "llm_disagreement", "relationship_ambiguous"), usage };
}

/**
 * Verifies supplied reciprocal anchors without creating links, targets, or new
 * wording. The judge receives only source-backed senses and existing glosses.
 */
export async function verifyCandidateRelationships(
  input: RelationshipVerificationInput,
  judge: RelationshipJudge | null,
): Promise<RelationshipVerificationResult> {
  const decisions: AnchorDecision[] = [];
  let usage = ZERO_USAGE;

  for (const [index, value] of input.anchors.entries()) {
    const runtime = runtimeAnchor(value);
    if (!runtime.valid) {
      decisions.push(decision(
        runtime.anchor,
        "ambiguous",
        "unavailable",
        "no_reciprocal_anchor",
      ));
      continue;
    }
    const anchor = runtime.anchor;
    const result = await verifyAnchor(input, anchor, index, judge);
    decisions.push(result.decision);
    usage = plusUsage(usage, result.usage);
  }

  return {
    decisions,
    hasSupportedAnchor: decisions.some((anchor) => anchor.decision === "supported"),
    usage,
  };
}
