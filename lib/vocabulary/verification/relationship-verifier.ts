import { TokenBudget, type TokenUsage } from "../enrichment/budget";
import type { VocabularyRecord, VocabularySense } from "../schema";
import { evidenceForSources, isFactualSourceId, sourceRefsForSense } from "../source-evidence";
import { RelationshipDecisionSchema } from "./decision-schema";
import type { FactualDictionaryEvidence } from "./provider-types";
import type { EligibleFactualSense } from "./sense-verifier";
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

function nonEmptyGloss(value: string | null): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function factualSource(sourceId: string): boolean {
  try {
    return isFactualSourceId(sourceId);
  } catch {
    return false;
  }
}

function hasTrustedSynonymProvenance(value: unknown): value is FactualDictionaryEvidence {
  if (typeof value !== "object" || value === null) return false;
  const evidence = value as Partial<FactualDictionaryEvidence>;
  return (evidence.provider === "wordnet" || evidence.provider === "dictionaryapi")
    && evidence.source?.sourceId === evidence.provider
    && Array.isArray(evidence.detail?.synonyms);
}

function factualSynonymKeys(evidence: readonly FactualDictionaryEvidence[]): Set<string> {
  const keys = new Set<string>();
  for (const item of evidence) {
    if (!hasTrustedSynonymProvenance(item)) continue;
    for (const synonym of item.detail.synonyms) {
      if (typeof synonym !== "string") continue;
      const key = normalizeComparisonKey(synonym);
      if (key) keys.add(key);
    }
  }
  return keys;
}

function publishedFactualCoreSenses(core: VocabularyRecord): VocabularySense[] {
  return core.senses.filter((sense) => {
    if (sense.status !== "published") return false;
    try {
      return evidenceForSources(sourceRefsForSense(sense), { verified: false }) !== "ai-draft";
    } catch {
      return false;
    }
  });
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
  if (!factualSource(input.selectedSense.source.sourceId) || resolved.senses.length === 0) {
    return { decision: decision(anchor, "ambiguous", "unavailable", "no_factual_sense"), usage: ZERO_USAGE };
  }

  const synonymKeys = factualSynonymKeys(input.factualDictionaryEvidence);
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
  const candidateFirstId = `${baseRequestId}:candidate-first`;
  const coreFirstId = `${baseRequestId}:core-first`;
  if (
    !input.tokenBudget.reserve(candidateFirstId, input.estimatedUsage)
    || !input.tokenBudget.reserve(coreFirstId, input.estimatedUsage)
  ) {
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

  for (const [index, anchor] of input.anchors.entries()) {
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
