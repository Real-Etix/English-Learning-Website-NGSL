import { importDictionaryDetail } from "../enrichment/dictionary-import";
import { VocabularyRecordSchema, type ContentSourceRef, type VocabularyRecord } from "../schema";
import type { FactualDictionaryEvidence, SourcedExampleEvidence } from "./provider-types";

function sameSource(left: ContentSourceRef, right: ContentSourceRef): boolean {
  return left.sourceId === right.sourceId
    && left.externalId === right.externalId
    && left.url === right.url
    && left.retrievedAt === right.retrievedAt
    && left.contentHash === right.contentHash;
}

function sameSourceList(left: readonly ContentSourceRef[], right: readonly ContentSourceRef[]): boolean {
  return left.length === right.length
    && left.every((source, index) => sameSource(source, right[index]!));
}

function validDictionaryEvidence(evidence: FactualDictionaryEvidence): boolean {
  return (evidence.provider === "wordnet" || evidence.provider === "dictionaryapi")
    && evidence.source.sourceId === evidence.provider;
}

function comparisonKey(value: string): string {
  return value.normalize("NFC").replace(/_/g, " ").trim().toLocaleLowerCase("en-US").replace(/\s+/gu, " ");
}

function assertEvidenceIdentity(record: VocabularyRecord, evidence: FactualDictionaryEvidence): void {
  if (comparisonKey(evidence.returnedLemma) !== comparisonKey(record.lemma)) {
    throw new Error(`Dictionary evidence lemma mismatch for ${record.lemma}: ${evidence.returnedLemma}`);
  }
  if (comparisonKey(evidence.requestedPartOfSpeech) !== comparisonKey(record.partOfSpeech)) {
    throw new Error(`Dictionary evidence part of speech mismatch for ${record.lemma}`);
  }
  if (
    evidence.detail.senses.length === 0
    || evidence.detail.senses.some((sense) =>
      comparisonKey(sense.partOfSpeech) !== comparisonKey(record.partOfSpeech))
  ) {
    throw new Error(`Dictionary sense part of speech mismatch for ${record.lemma}`);
  }
}

function validSelectedExample(example: SourcedExampleEvidence): boolean {
  return example.language === "eng"
    && example.source.sourceId === "tatoeba"
    && example.id.trim().length > 0
    && example.text.trim().length > 0;
}

/**
 * Imports normalized factual evidence without changing provider-authored text.
 * Reapplying the same evidence produces an identical canonical record.
 */
export function importVerificationEvidence(
  record: VocabularyRecord,
  dictionaryEvidence: readonly FactualDictionaryEvidence[],
  selectedSenseId: string | null,
  selectedExample: SourcedExampleEvidence | null,
): VocabularyRecord {
  let imported = VocabularyRecordSchema.parse(record);

  for (const evidence of dictionaryEvidence) {
    if (!validDictionaryEvidence(evidence)) {
      throw new Error(`Dictionary evidence provider/source mismatch for ${record.lemma}`);
    }
    assertEvidenceIdentity(record, evidence);
    imported = importDictionaryDetail(imported, evidence.detail, evidence.source).record;
  }

  if (selectedSenseId !== null) {
    const selectedIndex = imported.senses.findIndex((sense) => sense.id === selectedSenseId);
    if (selectedIndex < 0) throw new Error(`Selected sense not found for ${record.lemma}: ${selectedSenseId}`);

    if (selectedExample !== null) {
      if (!validSelectedExample(selectedExample)) {
        throw new Error(`Selected example must be sourced from Tatoeba for ${record.lemma}`);
      }
      const selectedSense = imported.senses[selectedIndex]!;
      const exampleSources = [selectedExample.source];
      const exists = selectedSense.examples.some((example) =>
        example.text === selectedExample.text
        && sameSourceList(example.sources, exampleSources),
      );
      if (!exists) {
        const senses = imported.senses.map((sense, index) => index === selectedIndex
          ? {
            ...sense,
            examples: [...sense.examples, { text: selectedExample.text, sources: exampleSources }],
          }
          : sense);
        imported = { ...imported, senses };
      }
    }
  } else if (selectedExample !== null) {
    throw new Error(`Selected example has no selected sense for ${record.lemma}`);
  }

  return VocabularyRecordSchema.parse(imported);
}
