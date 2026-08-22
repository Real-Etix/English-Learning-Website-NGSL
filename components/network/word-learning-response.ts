import type { WordDetail } from "../../lib/content/word-detail";
import { buildWordLearningProfile, type WordLearningProfile } from "../../lib/content/word-learning";
import { toCanonicalRecord, type LegacyWordPage } from "../../lib/vocabulary/legacy-profile-adapter";
import { isFactualSourceId, sourceEntryFor } from "../../lib/vocabulary/source-evidence";

export type WordLearningResponse = {
  page: LegacyWordPage;
  detail: WordDetail | null;
  learning?: unknown;
};

const isText = (value: unknown) => typeof value === "string";
const isOptionalText = (value: unknown) => value === null || isText(value);
const isOptionalNumber = (value: unknown) => value === null || typeof value === "number";
const isTextArray = (value: unknown) => Array.isArray(value) && value.every(isText);
function isLearningSource(value: unknown): boolean {
  if (typeof value !== "object" || value === null) return false;
  const source = value as Record<string, unknown>;
  if (!isText(source.sourceId) || !isText(source.label)
    || !isOptionalText(source.externalId) || !isOptionalText(source.url)
    || !isOptionalText(source.retrievedAt) || !isOptionalText(source.contentHash)) return false;

  try {
    const entry = sourceEntryFor(source.sourceId);
    return isFactualSourceId(source.sourceId) && source.label === entry.label;
  } catch {
    return false;
  }
}

const isLearningSourceArray = (value: unknown) => Array.isArray(value) && value.every(isLearningSource);
const isLearningSourceArrayWithEntries = (value: unknown) => isLearningSourceArray(value) && (value as unknown[]).length > 0;
const isAttributedGuidance = (value: unknown) => typeof value === "object" && value !== null
  && isLearningSourceArrayWithEntries((value as Record<string, unknown>).sources);
const normalizeLemma = (lemma: string) => lemma.trim().toLowerCase().replace(/\s+/g, " ");
const lemmasMatch = (left: string, right: string) => {
  const normalizedLeft = normalizeLemma(left);
  const normalizedRight = normalizeLemma(right);
  return Boolean(normalizedLeft) && normalizedLeft === normalizedRight;
};

function isLegacyWordPage(value: unknown): value is LegacyWordPage {
  if (typeof value !== "object" || value === null) return false;
  const page = value as Record<string, unknown>;
  return isText(page.lemma) && Boolean(normalizeLemma(page.lemma))
    && isText(page.display) && (page.tier === "core" || page.tier === "advanced")
    && isText(page.pos) && isOptionalNumber(page.rank) && isOptionalNumber(page.sfi)
    && isOptionalText(page.chart) && isOptionalText(page.region) && isTextArray(page.lists)
    && isTextArray(page.forms) && isText(page.status) && isTextArray(page.sources)
    && isText(page.definition) && isOptionalText(page.usageNote) && isTextArray(page.examples)
    && Array.isArray(page.connections) && page.connections.every((connection) => typeof connection === "object" && connection !== null
      && isText((connection as Record<string, unknown>).type) && isText((connection as Record<string, unknown>).target)
      && (!("gloss" in connection) || isOptionalText((connection as Record<string, unknown>).gloss)))
    && isTextArray(page.domains);
}

export function isWordLearningProfile(value: unknown): value is WordLearningProfile {
  if (typeof value !== "object" || value === null) return false;
  const profile = value as Record<string, unknown>;
  const pronunciation = profile.pronunciation as Record<string, unknown> | null;
  return isText(profile.lemma) && isText(profile.display) && isText(profile.tier)
    && isText(profile.partOfSpeech) && Array.isArray(profile.forms) && profile.forms.every(isText)
    && isText(profile.status) && Array.isArray(profile.sources) && profile.sources.every(isText)
    && isText(profile.evidence) && isText(profile.evidenceLabel)
    && typeof pronunciation === "object" && pronunciation !== null
    && isOptionalText(pronunciation.ipa) && isOptionalText(pronunciation.audioUk)
    && isOptionalText(pronunciation.audioUs) && isOptionalText(pronunciation.audioAny)
    && Array.isArray(profile.senses) && profile.senses.every((sense) => typeof sense === "object" && sense !== null
      && isText((sense as Record<string, unknown>).id) && isText((sense as Record<string, unknown>).partOfSpeech)
      && isText((sense as Record<string, unknown>).definition) && isOptionalText((sense as Record<string, unknown>).example)
      && isText((sense as Record<string, unknown>).source) && typeof (sense as Record<string, unknown>).primary === "boolean")
    && Array.isArray(profile.examples) && profile.examples.every((example) => typeof example === "object" && example !== null
      && isText((example as Record<string, unknown>).text) && isText((example as Record<string, unknown>).source))
    && Array.isArray(profile.usagePatterns) && profile.usagePatterns.every((pattern) => isAttributedGuidance(pattern)
      && isText((pattern as Record<string, unknown>).pattern) && isText((pattern as Record<string, unknown>).explanation)
      && Array.isArray((pattern as Record<string, unknown>).examples)
      && ((pattern as Record<string, unknown>).examples as unknown[]).every((example) => typeof example === "object" && example !== null
        && isText((example as Record<string, unknown>).text) && isLearningSourceArrayWithEntries((example as Record<string, unknown>).sources)))
    && Array.isArray(profile.collocations) && profile.collocations.every((collocation) => isAttributedGuidance(collocation)
      && isText((collocation as Record<string, unknown>).phrase) && isOptionalText((collocation as Record<string, unknown>).explanation))
    && Array.isArray(profile.commonMistakes) && profile.commonMistakes.every((mistake) => isAttributedGuidance(mistake)
      && isText((mistake as Record<string, unknown>).incorrect) && isText((mistake as Record<string, unknown>).correction)
      && isText((mistake as Record<string, unknown>).explanation))
    && isOptionalText(profile.usageNote)
    && Array.isArray(profile.connections) && profile.connections.every((connection) => typeof connection === "object" && connection !== null
      && isText((connection as Record<string, unknown>).type) && isText((connection as Record<string, unknown>).target)
      && ("gloss" in connection ? isOptionalText((connection as Record<string, unknown>).gloss) : true)
      && typeof (connection as Record<string, unknown>).explained === "boolean")
    && typeof profile.canClaim === "boolean" && isOptionalText(profile.claimBlockReason);
}

export function resolveWordLearningProfile(
  response: WordLearningResponse | null | undefined,
  expectedLemma?: string,
): WordLearningProfile | null {
  if (!response || !isLegacyWordPage(response.page)
    || (expectedLemma !== undefined && !lemmasMatch(response.page.lemma, expectedLemma))) return null;
  return isWordLearningProfile(response.learning) && lemmasMatch(response.learning.lemma, response.page.lemma)
    ? response.learning
    : buildWordLearningProfile(toCanonicalRecord(response.page), response.detail);
}
