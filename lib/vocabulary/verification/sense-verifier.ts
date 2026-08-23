import type { ContentSourceRef, VocabularyRecord } from "../schema";
import { TokenBudget, type TokenUsage } from "../enrichment/budget";
import { dictionarySenseId, type DictionaryImportSource } from "../enrichment/dictionary-import";
import { isFactualSourceId } from "../source-evidence";
import type { FactualDictionaryEvidence, SourcedExampleEvidence } from "./provider-types";
import { SenseSelectionDecisionSchema } from "./decision-schema";
import type { VerificationReasonCode } from "./types";

export type EligibleFactualExample = {
  id: string;
  text: string;
  source: DictionaryImportSource | ContentSourceRef;
};

/** Source-backed wording a judge may choose from, never rewrite. */
export type EligibleFactualSense = {
  id: string;
  partOfSpeech: string;
  definition: string;
  source: DictionaryImportSource;
  examples: EligibleFactualExample[];
};

export type SenseJudgeRequest = {
  candidate: { lemma: string; partOfSpeech: string; forms: string[] };
  senses: Array<{ id: string; partOfSpeech: string; definition: string }>;
  examples: Array<{ id: string; text: string }>;
};

export type SenseJudge = (request: SenseJudgeRequest) => Promise<{ decision: unknown; usage: TokenUsage }>;

export type SenseVerificationInput = {
  candidate: VocabularyRecord;
  dictionaryEvidence: readonly FactualDictionaryEvidence[];
  tatoebaExamples: readonly SourcedExampleEvidence[];
  tokenBudget: TokenBudget;
  requestId: string;
  estimatedUsage: TokenUsage;
};

export type SenseVerificationResult = {
  eligibleSenses: EligibleFactualSense[];
  selectedSenseId: string | null;
  selectedExampleId: string | null;
  reason: VerificationReasonCode | null;
  decisionSource: "deterministic" | "llm" | "unavailable";
  usage: TokenUsage;
};

const PLACEHOLDER_CONTENT = /definition pending|needs a fuller dictionary source/i;
const ZERO_USAGE: TokenUsage = { inputTokens: 0, outputTokens: 0 };

function normalizeText(value: string): string {
  return value.normalize("NFC").replace(/_/g, " ").trim().toLocaleLowerCase("en-US").replace(/\s+/gu, " ");
}

function normalizedPartOfSpeech(value: string): string {
  return value.trim().toLocaleLowerCase("en-US");
}

function usableDefinition(value: string): boolean {
  return Boolean(value.trim()) && !PLACEHOLDER_CONTENT.test(value);
}

function factualSource(sourceId: string): boolean {
  try {
    return isFactualSourceId(sourceId);
  } catch {
    return false;
  }
}

function hasCompleteForm(text: string, form: string): boolean {
  if (!form) return false;
  const escaped = form.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(?<![\\p{L}\\p{M}\\p{N}_])${escaped}(?![\\p{L}\\p{M}\\p{N}_])`, "iu")
    .test(text.normalize("NFC"));
}

function matchingForms(candidate: VocabularyRecord): string[] {
  return Array.from(new Set([candidate.lemma, ...candidate.forms].map(normalizeText).filter(Boolean)));
}

function hasMatchingForm(text: string, forms: readonly string[]): boolean {
  return forms.some((form) => hasCompleteForm(text, form));
}

function dictionaryExampleId(senseId: string): string {
  return `dictionary:${senseId}:example`;
}

/**
 * Filters provider output to factual, exact-lemma, exact-POS senses without
 * normalizing the wording retained for review or later import.
 */
export function eligibleFactualSenses(
  candidate: VocabularyRecord,
  evidence: readonly FactualDictionaryEvidence[],
): EligibleFactualSense[] {
  const lemma = normalizeText(candidate.lemma);
  const partOfSpeech = normalizedPartOfSpeech(candidate.partOfSpeech);
  const forms = matchingForms(candidate);
  const eligible = new Map<string, EligibleFactualSense>();

  for (const providerEvidence of evidence) {
    if (!factualSource(providerEvidence.source.sourceId)) continue;
    if (normalizeText(providerEvidence.returnedLemma) !== lemma) continue;
    if (normalizedPartOfSpeech(providerEvidence.requestedPartOfSpeech) !== partOfSpeech) continue;

    for (const sense of providerEvidence.detail.senses) {
      if (normalizedPartOfSpeech(sense.partOfSpeech) !== partOfSpeech || !usableDefinition(sense.definition)) continue;
      const id = dictionarySenseId(candidate, providerEvidence.detail, sense, providerEvidence.source.sourceId);
      if (eligible.has(id)) continue;
      const examples: EligibleFactualExample[] = [];
      if (sense.example && hasMatchingForm(sense.example, forms)) {
        examples.push({ id: dictionaryExampleId(id), text: sense.example, source: providerEvidence.source });
      }
      eligible.set(id, {
        id,
        partOfSpeech: sense.partOfSpeech,
        definition: sense.definition,
        source: providerEvidence.source,
        examples,
      });
    }
  }
  return [...eligible.values()];
}

function hasPosMismatch(candidate: VocabularyRecord, evidence: readonly FactualDictionaryEvidence[]): boolean {
  const lemma = normalizeText(candidate.lemma);
  const partOfSpeech = normalizedPartOfSpeech(candidate.partOfSpeech);
  return evidence.some((providerEvidence) =>
    factualSource(providerEvidence.source.sourceId)
    && normalizeText(providerEvidence.returnedLemma) === lemma
    && providerEvidence.detail.senses.some((sense) => usableDefinition(sense.definition))
    && (
      normalizedPartOfSpeech(providerEvidence.requestedPartOfSpeech) !== partOfSpeech
      || !providerEvidence.detail.senses.some((sense) =>
        normalizedPartOfSpeech(sense.partOfSpeech) === partOfSpeech && usableDefinition(sense.definition),
      )
    ),
  );
}

function eligibleTatoebaExamples(
  candidate: VocabularyRecord,
  examples: readonly SourcedExampleEvidence[],
): EligibleFactualExample[] {
  const forms = matchingForms(candidate);
  const eligible = new Map<string, EligibleFactualExample>();
  for (const example of examples) {
    if (
      example.language !== "eng"
      || example.source.sourceId !== "tatoeba"
      || !factualSource(example.source.sourceId)
      || !example.id.trim()
      || !example.text.trim()
      || !hasMatchingForm(example.text, forms)
      || eligible.has(example.id)
    ) continue;
    eligible.set(example.id, { id: example.id, text: example.text, source: example.source });
  }
  return [...eligible.values()];
}

function result(
  eligibleSenses: EligibleFactualSense[],
  selectedSenseId: string | null,
  selectedExampleId: string | null,
  reason: VerificationReasonCode | null,
  decisionSource: SenseVerificationResult["decisionSource"],
  usage: TokenUsage = ZERO_USAGE,
): SenseVerificationResult {
  return { eligibleSenses, selectedSenseId, selectedExampleId, reason, decisionSource, usage };
}

function requestFor(
  candidate: VocabularyRecord,
  senses: EligibleFactualSense[],
  examples: EligibleFactualExample[],
): SenseJudgeRequest {
  return {
    candidate: { lemma: candidate.lemma, partOfSpeech: candidate.partOfSpeech, forms: [...candidate.forms] },
    senses: senses.map((sense) => ({ id: sense.id, partOfSpeech: sense.partOfSpeech, definition: sense.definition })),
    examples: examples.map((example) => ({ id: example.id, text: example.text })),
  };
}

/**
 * Makes one finite selection over source-backed facts. The judge is never
 * allowed to author definitions, examples, source identities, or statuses.
 */
export async function verifyCandidateSense(
  input: SenseVerificationInput,
  judge: SenseJudge | null,
): Promise<SenseVerificationResult> {
  const eligibleSenses = eligibleFactualSenses(input.candidate, input.dictionaryEvidence);
  if (eligibleSenses.length === 0) {
    return result(eligibleSenses, null, null, hasPosMismatch(input.candidate, input.dictionaryEvidence) ? "pos_mismatch" : "no_factual_sense", "deterministic");
  }

  const dictionaryExamples = eligibleSenses.flatMap((sense) => sense.examples);
  const tatoebaExamples = eligibleTatoebaExamples(input.candidate, input.tatoebaExamples);
  const examples = [...dictionaryExamples, ...tatoebaExamples];
  if (examples.length === 0) return result(eligibleSenses, null, null, "no_sourced_example", "deterministic");

  if (eligibleSenses.length === 1 && dictionaryExamples.length > 0) {
    return result(eligibleSenses, eligibleSenses[0]!.id, dictionaryExamples[0]!.id, null, "deterministic");
  }

  if (!judge) return result(eligibleSenses, null, null, "judge_unavailable", "unavailable");
  if (!input.tokenBudget.reserve(input.requestId, input.estimatedUsage)) {
    return result(eligibleSenses, null, null, "budget_exhausted", "unavailable");
  }

  let judged: { decision: unknown; usage: TokenUsage };
  try {
    judged = await judge(requestFor(input.candidate, eligibleSenses, examples));
  } catch {
    input.tokenBudget.recordActual(input.requestId, input.estimatedUsage);
    return result(eligibleSenses, null, null, "judge_unavailable", "unavailable", input.estimatedUsage);
  }
  input.tokenBudget.recordActual(input.requestId, judged.usage);

  const decision = SenseSelectionDecisionSchema.safeParse(judged.decision);
  if (!decision.success || decision.data.decision === "ambiguous") {
    return result(eligibleSenses, null, null, "sense_ambiguous", "llm", judged.usage);
  }

  const senseIds = new Set(eligibleSenses.map((sense) => sense.id));
  const selectedSense = eligibleSenses.find((sense) => sense.id === decision.data.senseId);
  const selectedExampleIsEligible = decision.data.exampleId === null
    || tatoebaExamples.some((example) => example.id === decision.data.exampleId)
    || selectedSense?.examples.some((example) => example.id === decision.data.exampleId);
  if (!senseIds.has(decision.data.senseId) || !selectedExampleIsEligible) {
    return result(eligibleSenses, null, null, "sense_ambiguous", "llm", judged.usage);
  }
  return result(eligibleSenses, decision.data.senseId, decision.data.exampleId, null, "llm", judged.usage);
}
