import { createHash } from "node:crypto";

import type { WordDetail } from "../../content/word-detail";
import type { FactualDictionaryEvidence } from "./provider-types";

const lookupMethod = {
  noun: "lookupNoun",
  verb: "lookupVerb",
  adjective: "lookupAdjective",
  adverb: "lookupAdverb",
} as const;

type CanonicalPartOfSpeech = keyof typeof lookupMethod;
type WordNetSynset = {
  synsetOffset: string | number;
  pos: string;
  lemma: string;
  synonyms: string[];
  def: string;
  exp: string[];
};

export type WordNetLookup = {
  [K in (typeof lookupMethod)[CanonicalPartOfSpeech]]: (lemma: string) => Promise<WordNetSynset[]>;
};

export type LookupWordNetEvidenceOptions = {
  lookup: WordNetLookup;
  retrievedAt: string | null;
};

function normalizedLemma(value: string): string {
  return value.replace(/_/g, " ").replace(/\s+/g, " ").trim();
}

function hasCompleteCandidateToken(text: string, candidate: string): boolean {
  if (!candidate) return false;
  const escaped = candidate.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(?<![\\p{L}\\p{N}_])${escaped}(?![\\p{L}\\p{N}_])`, "iu").test(text);
}

function contentHash(detail: WordDetail): string {
  return `sha256:${createHash("sha256").update(JSON.stringify(detail), "utf8").digest("hex")}`;
}

function canonicalPartOfSpeech(value: string): CanonicalPartOfSpeech | null {
  const partOfSpeech = value.trim().toLowerCase();
  return partOfSpeech in lookupMethod ? partOfSpeech as CanonicalPartOfSpeech : null;
}

export async function lookupWordNetEvidence(
  lemma: string,
  partOfSpeech: string,
  options: LookupWordNetEvidenceOptions,
): Promise<FactualDictionaryEvidence | null> {
  const normalizedPartOfSpeech = canonicalPartOfSpeech(partOfSpeech);
  if (!normalizedPartOfSpeech) return null;

  const synsets = await options.lookup[lookupMethod[normalizedPartOfSpeech]](lemma);
  if (!Array.isArray(synsets) || synsets.length === 0) return null;

  const candidate = normalizedLemma(lemma);
  const senses = synsets.map((synset) => {
    const externalId = `${normalizedPartOfSpeech}:${synset.synsetOffset}`;
    const example = synset.exp.find((value) => hasCompleteCandidateToken(value, candidate)) ?? null;

    return {
      partOfSpeech: normalizedPartOfSpeech,
      definition: synset.def,
      example,
      sourceEntryId: externalId,
      sourceSenseId: externalId,
    };
  });
  const detail: WordDetail = {
    ipa: null,
    audioUk: null,
    audioUs: null,
    audioAny: null,
    sourceEntryId: senses[0]!.sourceEntryId,
    senses,
    synonyms: Array.from(new Set(synsets.flatMap((synset) => synset.synonyms)
      .map(normalizedLemma)
      .filter(Boolean))),
  };

  return {
    provider: "wordnet",
    returnedLemma: normalizedLemma(synsets[0]!.lemma),
    requestedPartOfSpeech: partOfSpeech,
    detail,
    source: {
      sourceId: "wordnet",
      url: null,
      retrievedAt: options.retrievedAt,
      contentHash: contentHash(detail),
    },
  };
}
