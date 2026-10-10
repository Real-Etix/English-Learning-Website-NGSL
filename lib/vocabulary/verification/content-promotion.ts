import { isSenseContentReady } from "../publication";
import { VocabularyRecordSchema, type VocabularyRecord, type VocabularySense } from "../schema";

export type RelationshipOnlyReason = "relationship_ambiguous" | "relationship_unsupported";

export type ContentPromotionResult = {
  snapshot: VocabularyRecord[];
  updates: VocabularyRecord[];
  promoted: Array<{ lemma: string; senseId: string; relationshipStatus: "ambiguous" | "unsupported" }>;
  unresolved: Array<{ lemma: string; reason: "missing_record" | "no_exact_sense" }>;
};

function changed(left: VocabularyRecord, right: VocabularyRecord): boolean {
  return JSON.stringify(left) !== JSON.stringify(right);
}

function selectedSense(
  record: VocabularyRecord,
  cachedSenseIds: ReadonlySet<string>,
): VocabularySense | null {
  const ready = record.senses.filter((sense) => isSenseContentReady(record, sense));
  const cachedReady = ready.filter((sense) => cachedSenseIds.has(sense.id));
  if (cachedReady.length === 1) return cachedReady[0]!;
  if (cachedReady.length > 1) return null;
  return ready.length === 1 ? ready[0]! : null;
}

function publishSelectedSense(record: VocabularyRecord, senseId: string): VocabularyRecord {
  return {
    ...record,
    status: "enriched",
    publicationStatus: "published",
    verificationStatus: "published",
    senses: record.senses.map((sense) => {
      if (sense.id === senseId) return { ...sense, status: "published" as const };
      if (sense.sources.some((source) => source.sourceId !== "llm")) {
        return { ...sense, status: "review" as const };
      }
      return { ...sense, status: "hidden" as const };
    }),
  };
}

/**
 * Promotes factual word content from completed relationship-only failures.
 * It never guesses between multiple ready senses and never publishes an edge.
 */
export function promoteRelationshipVerifiedContent(
  records: readonly VocabularyRecord[],
  reasons: ReadonlyMap<string, RelationshipOnlyReason>,
  cachedSelections: ReadonlyMap<string, ReadonlySet<string>>,
): ContentPromotionResult {
  const original = records.map((record) => VocabularyRecordSchema.parse(record));
  const byLemma = new Map(original.map((record) => [record.lemma, record]));
  const promoted: ContentPromotionResult["promoted"] = [];
  const unresolved: ContentPromotionResult["unresolved"] = [];
  const unsupported = new Set<string>();

  for (const [lemma, reason] of [...reasons].sort(([left], [right]) => left.localeCompare(right))) {
    const record = byLemma.get(lemma);
    if (!record) {
      unresolved.push({ lemma, reason: "missing_record" });
      continue;
    }
    const sense = selectedSense(record, cachedSelections.get(lemma) ?? new Set());
    if (!sense) {
      unresolved.push({ lemma, reason: "no_exact_sense" });
      continue;
    }
    const relationshipStatus = reason === "relationship_unsupported" ? "unsupported" : "ambiguous";
    let next = publishSelectedSense(record, sense.id);
    next = {
      ...next,
      relationshipVerificationStatus: relationshipStatus,
      connections: relationshipStatus === "unsupported"
        ? next.connections.map((connection) => connection.type === "builds_on"
          ? { ...connection, status: "hidden" as const }
          : connection)
        : next.connections,
    };
    byLemma.set(lemma, VocabularyRecordSchema.parse(next));
    if (relationshipStatus === "unsupported") unsupported.add(lemma);
    promoted.push({ lemma, senseId: sense.id, relationshipStatus });
  }

  if (unsupported.size > 0) {
    for (const [lemma, record] of byLemma) {
      const next = {
        ...record,
        connections: record.connections.map((connection) =>
          connection.type === "advanced_form" && unsupported.has(connection.target)
            ? { ...connection, status: "hidden" as const }
            : connection),
      };
      byLemma.set(lemma, VocabularyRecordSchema.parse(next));
    }
  }

  const snapshot = original.map((record) => byLemma.get(record.lemma)!);
  return {
    snapshot,
    updates: snapshot.filter((record, index) => changed(record, original[index]!)),
    promoted,
    unresolved,
  };
}
