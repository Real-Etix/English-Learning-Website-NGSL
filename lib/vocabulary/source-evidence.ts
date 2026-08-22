import sourceRegistryFile from "../../content/vocabulary/sources.json";

import { SourceRegistrySchema, type ContentSourceRef, type SourceRegistryEntry } from "./schema";

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
