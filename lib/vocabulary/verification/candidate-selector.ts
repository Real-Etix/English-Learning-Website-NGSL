import type { VocabularyRecord } from "../schema";
import type { ReciprocalCoreAnchor, VerificationCandidate } from "./types";

function hasNonEmptyGloss(gloss: string | null): gloss is string {
  return typeof gloss === "string" && gloss.trim().length > 0;
}

function reciprocalAnchors(
  candidate: VocabularyRecord,
  recordsByLemma: Map<string, VocabularyRecord>,
): ReciprocalCoreAnchor[] {
  const anchorsByCoreLemma = new Map<string, ReciprocalCoreAnchor>();

  for (const candidateConnection of candidate.connections) {
    if (
      candidateConnection.type !== "builds_on"
      || candidateConnection.status !== "published"
      || !hasNonEmptyGloss(candidateConnection.gloss)
      || anchorsByCoreLemma.has(candidateConnection.target)
    ) continue;

    const core = recordsByLemma.get(candidateConnection.target);
    if (core?.tier !== "core" || core.publicationStatus !== "published") continue;

    const coreConnection = core.connections.find((connection) =>
      connection.target === candidate.lemma
      && connection.type === "advanced_form"
      && connection.status === "published"
      && hasNonEmptyGloss(connection.gloss),
    );
    if (!coreConnection || !hasNonEmptyGloss(coreConnection.gloss)) continue;

    anchorsByCoreLemma.set(core.lemma, {
      coreLemma: core.lemma,
      candidateType: "builds_on",
      coreType: "advanced_form",
      candidateGloss: candidateConnection.gloss,
      coreGloss: coreConnection.gloss,
    });
  }

  return [...anchorsByCoreLemma.values()];
}

export function selectAdvancedVerificationCandidates(
  records: readonly VocabularyRecord[],
  limit: number,
): VerificationCandidate[] {
  if (!Number.isInteger(limit) || limit < 0) {
    throw new Error("limit must be a non-negative integer");
  }

  const recordsByLemma = new Map<string, VocabularyRecord>();
  for (const record of records) recordsByLemma.set(record.lemma, record);

  const hiddenAdvanced = [...recordsByLemma.values()].filter((record) =>
    record.tier === "advanced" && record.publicationStatus === "hidden",
  );
  const hiddenAdvancedLemmas = new Set(hiddenAdvanced.map((record) => record.lemma));
  const incomingPublishedCounts = new Map<string, number>();

  for (const core of recordsByLemma.values()) {
    if (core.tier !== "core" || core.publicationStatus !== "published") continue;
    for (const connection of core.connections) {
      if (connection.status !== "published" || !hiddenAdvancedLemmas.has(connection.target)) continue;
      incomingPublishedCounts.set(
        connection.target,
        (incomingPublishedCounts.get(connection.target) ?? 0) + 1,
      );
    }
  }

  const candidates = hiddenAdvanced.map((record): VerificationCandidate => {
    const anchors = reciprocalAnchors(record, recordsByLemma);
    return {
      record,
      anchors,
      incomingPublishedCount: incomingPublishedCounts.get(record.lemma) ?? 0,
      distinctPublishedCoreAnchors: anchors.length,
    };
  });

  candidates.sort((left, right) =>
    right.incomingPublishedCount - left.incomingPublishedCount
    || right.distinctPublishedCoreAnchors - left.distinctPublishedCoreAnchors
    || left.record.lemma.localeCompare(right.record.lemma),
  );

  return candidates.slice(0, limit);
}
