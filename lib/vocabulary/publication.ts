import {
  type PublicationStatus,
  type VocabularyConnection,
  type VocabularyRecord,
  type VocabularySense,
} from "./schema";
import { evidenceForSources, sourceRefsForSense } from "./source-evidence";
import { hasCurrentMeaningReview, hasFactualExample } from "./meaning-review";
const PLACEHOLDER_CONTENT = /definition pending|needs a fuller dictionary source/i;

function isUsableDefinition(value: string): boolean {
  return Boolean(value.trim()) && !PLACEHOLDER_CONTENT.test(value);
}

/** Classifies one sense without treating LLM output as factual evidence. */
export function factualEvidenceFor(record: VocabularyRecord, sense: VocabularySense): "verified" | "source-backed" | "ai-draft" {
  return evidenceForSources(sourceRefsForSense(sense), {
    verified: isUsableDefinition(sense.definition) && (record.status === "verified" || sense.status === "published"),
  });
}

/** Content readiness is independent from the persisted review/publication flag. */
export function isSenseContentReady(record: VocabularyRecord, sense: VocabularySense): boolean {
  if (sense.meaningReview && !hasCurrentMeaningReview(record, sense)) return false;
  return factualEvidenceFor(record, sense) !== "ai-draft"
    && isUsableDefinition(sense.definition)
    && (hasFactualExample(sense) || hasCurrentMeaningReview(record, sense));
}

/** A public sense needs factual evidence and an example or an explicit current meaning review. */
export function isSensePublishable(record: VocabularyRecord, sense: VocabularySense): boolean {
  return sense.status === "published" && isSenseContentReady(record, sense);
}

/** Learner-facing edges must have both an explicit publication review and guidance. */
export function isLearnerConnection(connection: Pick<VocabularyConnection, "status" | "gloss">): boolean {
  return connection.status === "published" && Boolean(connection.gloss?.trim());
}

/**
 * Calculates the persisted publication state. Existing non-public states are
 * never promoted by this quarantine pass. Word content is independent from
 * graph relationships: learner-facing edges have their own publication gate.
 */
export function publicationStatusFor(record: VocabularyRecord, records: Iterable<VocabularyRecord> = []): PublicationStatus {
  void records;
  if (record.tier === "advanced" && record.editorial?.scope?.status === "archived") return "hidden";
  if (record.publicationStatus !== "published" || record.tier === "core") return record.publicationStatus;
  const supportsPublication = record.senses.some((sense) => isSensePublishable(record, sense));
  return supportsPublication ? "published" : "hidden";
}

/** Returns whether a record may flow into public word and graph artifacts. */
export function isWordPublic(record: VocabularyRecord, records: Iterable<VocabularyRecord> = []): boolean {
  return publicationStatusFor(record, records) === "published";
}
