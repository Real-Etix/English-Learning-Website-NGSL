import sourceRegistryFile from "../../content/vocabulary/sources.json";

import {
  SourceRegistrySchema,
  type ContentSourceRef,
  type PublicationStatus,
  type VocabularyConnection,
  type VocabularyRecord,
  type VocabularySense,
} from "./schema";

const sourceRegistry = SourceRegistrySchema.parse(sourceRegistryFile);
const FACTUAL_SOURCE_IDS = new Set(sourceRegistry.sources.filter((source) => source.factual).map((source) => source.id));
const PLACEHOLDER_CONTENT = /definition pending|needs a fuller dictionary source/i;

function hasFactualSource(sources: ContentSourceRef[]): boolean {
  return sources.some((source) => FACTUAL_SOURCE_IDS.has(source.sourceId));
}

function isUsableDefinition(value: string): boolean {
  return Boolean(value.trim()) && !PLACEHOLDER_CONTENT.test(value);
}

function hasSourcedExample(sense: VocabularySense): boolean {
  return sense.examples.some((example) => Boolean(example.text.trim()) && hasFactualSource(example.sources));
}

/** Classifies one sense without treating LLM output as factual evidence. */
export function factualEvidenceFor(record: VocabularyRecord, sense: VocabularySense): "verified" | "source-backed" | "ai-draft" {
  if (!hasFactualSource([...record.sources, ...sense.sources])) return "ai-draft";
  if (isUsableDefinition(sense.definition) && (record.status === "verified" || sense.status === "published")) return "verified";
  return "source-backed";
}

/** A public sense needs factual meaning evidence, usable authored content, and a factual example. */
export function isSensePublishable(record: VocabularyRecord, sense: VocabularySense): boolean {
  return factualEvidenceFor(record, sense) !== "ai-draft"
    && sense.status === "published"
    && isUsableDefinition(sense.definition)
    && hasSourcedExample(sense);
}

/** Learner-facing edges must have both an explicit publication review and guidance. */
export function isLearnerConnection(connection: Pick<VocabularyConnection, "status" | "gloss">): boolean {
  return connection.status === "published" && Boolean(connection.gloss?.trim());
}

function isPublicCoreRecord(record: VocabularyRecord): boolean {
  return record.tier === "core" && record.publicationStatus === "published";
}

function hasPublicCoreAnchor(record: VocabularyRecord, records: Iterable<VocabularyRecord>): boolean {
  const byLemma = new Map([...records].map((candidate) => [candidate.lemma, candidate]));
  return record.connections.some((connection) =>
    connection.type === "builds_on"
    && connection.status === "published"
    && Boolean(connection.gloss?.trim())
    && Boolean(byLemma.get(connection.target) && isPublicCoreRecord(byLemma.get(connection.target)!)),
  );
}

/**
 * Calculates the persisted publication state. Existing non-public states are
 * never promoted by this quarantine pass; unsupported published advanced words
 * are moved to hidden.
 */
export function publicationStatusFor(record: VocabularyRecord, records: Iterable<VocabularyRecord> = []): PublicationStatus {
  if (record.publicationStatus !== "published" || record.tier === "core") return record.publicationStatus;
  const supportsPublication = record.senses.some((sense) => isSensePublishable(record, sense))
    && hasPublicCoreAnchor(record, records);
  return supportsPublication ? "published" : "hidden";
}

/** Returns whether a record may flow into public word and graph artifacts. */
export function isWordPublic(record: VocabularyRecord, records: Iterable<VocabularyRecord> = []): boolean {
  return publicationStatusFor(record, records) === "published";
}
