import type { WordDetail } from "../../lib/content/word-detail";
import { buildWordLearningProfile, type WordLearningProfile } from "../../lib/content/word-learning";
import type { WikiPage } from "../../lib/wiki/parse-wiki";

export type WordLearningResponse = {
  page: WikiPage;
  detail: WordDetail | null;
  learning?: unknown;
};

const isText = (value: unknown) => typeof value === "string";
const isOptionalText = (value: unknown) => value === null || isText(value);
const isOptionalNumber = (value: unknown) => value === null || typeof value === "number";
const isTextArray = (value: unknown) => Array.isArray(value) && value.every(isText);
const normalizeLemma = (lemma: string) => lemma.trim().toLowerCase().replace(/\s+/g, " ");
const lemmasMatch = (left: string, right: string) => {
  const normalizedLeft = normalizeLemma(left);
  const normalizedRight = normalizeLemma(right);
  return Boolean(normalizedLeft) && normalizedLeft === normalizedRight;
};

function isWikiPage(value: unknown): value is WikiPage {
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
  if (!response || !isWikiPage(response.page)
    || (expectedLemma !== undefined && !lemmasMatch(response.page.lemma, expectedLemma))) return null;
  return isWordLearningProfile(response.learning) && lemmasMatch(response.learning.lemma, response.page.lemma)
    ? response.learning
    : buildWordLearningProfile(response.page, response.detail);
}
