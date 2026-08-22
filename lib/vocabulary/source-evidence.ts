import sourceRegistryFile from "../../content/vocabulary/sources.json";

import {
  SourceRegistrySchema,
  type ContentSourceRef,
  type SourceRegistryEntry,
  type VocabularyRecord,
  type VocabularySense,
} from "./schema";

export type SourceEvidence = "verified" | "source-backed" | "ai-draft";

const sourceRegistry = SourceRegistrySchema.parse(sourceRegistryFile);
const sourceEntries = new Map(sourceRegistry.sources.map((source) => [source.id, source]));

/** Returns a registered provider and makes unreviewed source IDs impossible to treat as evidence. */
export function sourceEntryFor(sourceId: string): SourceRegistryEntry {
  const source = sourceEntries.get(sourceId);
  if (!source) throw new Error(`Unknown vocabulary source ID: ${sourceId}`);
  return source;
}

export function isFactualSourceId(sourceId: string): boolean {
  return sourceEntryFor(sourceId).factual;
}

/** Sense evidence is authoritative; record evidence is only a legacy fallback for source-less senses. */
export function sourceRefsForSense(
  record: Pick<VocabularyRecord, "sources">,
  sense: Pick<VocabularySense, "sources">,
): readonly ContentSourceRef[] {
  return sense.sources.length > 0 ? sense.sources : record.sources;
}

/** Curated wording wins over factual imports, which in turn win over LLM drafts. */
export function sourcePrecedenceFor(sourceId: string): number {
  const source = sourceEntryFor(sourceId);
  if (source.id === "curated") return 3;
  return source.factual ? 2 : 1;
}

export function evidenceForSources(
  sources: readonly Pick<ContentSourceRef, "sourceId">[],
  options: { verified: boolean; allowVerifiedWithoutFactualSource?: boolean },
): SourceEvidence {
  if (!sources.some((source) => isFactualSourceId(source.sourceId))) {
    return sources.length === 0 && options.verified && options.allowVerifiedWithoutFactualSource
      ? "verified"
      : "ai-draft";
  }
  return options.verified ? "verified" : "source-backed";
}
