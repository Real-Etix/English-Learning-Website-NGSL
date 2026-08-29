import { dictionarySenseId } from "../enrichment/dictionary-import";
import { isSensePublishable, publicationStatusFor } from "../publication";
import {
  VocabularyRecordSchema,
  type VocabularyConnection,
  type VocabularyRecord,
  type VocabularySense,
} from "../schema";
import { evidenceForSources, sourceRefsForSense } from "../source-evidence";
import { importVerificationEvidence } from "./evidence-import";
import type { FactualDictionaryEvidence, SourcedExampleEvidence } from "./provider-types";
import type { AnchorDecision } from "./relationship-verifier";
import type { VerificationReasonCode } from "./types";

export type CandidateVerificationOutcome = {
  candidateLemma: string;
  dictionaryEvidence: FactualDictionaryEvidence[];
  selectedExample: SourcedExampleEvidence | null;
  selectedSenseId: string | null;
  relationships: AnchorDecision[];
  reason: VerificationReasonCode;
};

export type VerificationMutationResult = {
  snapshot: VocabularyRecord[];
  updates: VocabularyRecord[];
  publishedLemmas: string[];
  downgradedRelationshipCount: number;
};

function sourceBacked(sense: VocabularySense): boolean {
  try {
    return evidenceForSources(sourceRefsForSense(sense), { verified: false }) !== "ai-draft";
  } catch {
    return false;
  }
}

function withSenseStatuses(
  record: VocabularyRecord,
  selectedSenseId: string | null,
  publish: boolean,
): VocabularyRecord {
  const senses = record.senses.map((sense) => {
    if (sourceBacked(sense)) {
      return {
        ...sense,
        status: publish && sense.id === selectedSenseId ? "published" as const : "review" as const,
      };
    }
    return publish ? { ...sense, status: "hidden" as const } : sense;
  });
  return { ...record, senses };
}

function relationshipKey(decision: AnchorDecision): string {
  return JSON.stringify([
    decision.coreLemma,
    decision.candidateType,
    decision.coreType,
    decision.candidateGloss,
    decision.coreGloss,
  ]);
}

function selectedSenseIdsFromEvidence(
  record: VocabularyRecord,
  evidence: readonly FactualDictionaryEvidence[],
): Set<string> {
  return new Set(evidence.flatMap((item) => item.detail.senses.map((sense) =>
    dictionarySenseId(record, item.detail, sense, item.source.sourceId),
  )));
}

function requiredPublishedRelationshipKeys(
  candidate: VocabularyRecord,
  byLemma: ReadonlyMap<string, VocabularyRecord>,
): Set<string> {
  const keys = new Set<string>();
  const seenCores = new Set<string>();
  for (const connection of candidate.connections) {
    if (
      connection.type !== "builds_on"
      || connection.status !== "published"
      || !connection.gloss?.trim()
      || seenCores.has(connection.target)
    ) continue;
    const core = byLemma.get(connection.target);
    if (core?.tier !== "core" || core.publicationStatus !== "published") continue;
    const reverse = core.connections.find((item) =>
      item.target === candidate.lemma
      && item.type === "advanced_form"
      && item.status === "published"
      && Boolean(item.gloss?.trim()),
    );
    if (!reverse?.gloss) continue;
    seenCores.add(core.lemma);
    keys.add(JSON.stringify([
      core.lemma,
      "builds_on",
      "advanced_form",
      connection.gloss,
      reverse.gloss,
    ]));
  }
  return keys;
}

function matchingConnectionIndexes(
  connections: readonly VocabularyConnection[],
  identity: Pick<VocabularyConnection, "target" | "type" | "gloss">,
): number[] {
  const indexes: number[] = [];
  connections.forEach((connection, index) => {
    if (
      connection.target === identity.target
      && connection.type === identity.type
      && connection.gloss === identity.gloss
    ) indexes.push(index);
  });
  return indexes;
}

function replaceConnectionStatus(
  record: VocabularyRecord,
  index: number,
  status: VocabularyConnection["status"],
): VocabularyRecord {
  if (record.connections[index]?.status === status) return record;
  return {
    ...record,
    connections: record.connections.map((connection, candidateIndex) =>
      candidateIndex === index ? { ...connection, status } : connection),
  };
}

function requireUniqueConnection(
  record: VocabularyRecord,
  identity: Pick<VocabularyConnection, "target" | "type" | "gloss">,
  side: "candidate" | "core",
): number {
  const indexes = matchingConnectionIndexes(record.connections, identity);
  if (indexes.length !== 1) {
    throw new Error(`Expected one reciprocal ${side} connection for ${record.lemma}; found ${indexes.length}`);
  }
  return indexes[0]!;
}

function validateSnapshot(records: readonly VocabularyRecord[]): VocabularyRecord[] {
  const parsed = records.map((record) => VocabularyRecordSchema.parse(record));
  const lemmas = new Set<string>();
  for (const record of parsed) {
    if (lemmas.has(record.lemma)) throw new Error(`Duplicate lemma in verification snapshot: ${record.lemma}`);
    lemmas.add(record.lemma);
  }
  return parsed;
}

function changed(left: VocabularyRecord, right: VocabularyRecord): boolean {
  return JSON.stringify(left) !== JSON.stringify(right);
}

/** Applies a complete finite batch to a cloned snapshot and validates before returning. */
export function applyVerificationOutcomes(
  records: readonly VocabularyRecord[],
  outcomes: readonly CandidateVerificationOutcome[],
): VerificationMutationResult {
  const original = validateSnapshot(records);
  const byLemma = new Map(original.map((record) => [record.lemma, record]));
  const seenCandidates = new Set<string>();
  const proposedPublished = new Map<string, string>();
  let downgradedRelationshipCount = 0;

  for (const outcome of outcomes) {
    if (seenCandidates.has(outcome.candidateLemma)) {
      throw new Error(`Duplicate candidate outcome: ${outcome.candidateLemma}`);
    }
    seenCandidates.add(outcome.candidateLemma);

    const existing = byLemma.get(outcome.candidateLemma);
    if (!existing) throw new Error(`Missing candidate record: ${outcome.candidateLemma}`);
    if (existing.tier !== "advanced") {
      throw new Error(`Candidate identity mismatch for ${outcome.candidateLemma}: expected advanced tier`);
    }

    const publish = outcome.reason === "published";
    for (const relationship of outcome.relationships) {
      if (!byLemma.has(relationship.coreLemma)) {
        throw new Error(`Missing core record: ${relationship.coreLemma}`);
      }
    }
    if (publish && !outcome.relationships.some((relationship) => relationship.decision === "supported")) {
      throw new Error(`Publication requires a supported reciprocal relationship: ${existing.lemma}`);
    }
    const relationshipKeys = new Set(outcome.relationships.map(relationshipKey));
    const requiredRelationshipKeys = requiredPublishedRelationshipKeys(existing, byLemma);
    if ([...requiredRelationshipKeys].some((key) => !relationshipKeys.has(key))) {
      throw new Error(`Outcome does not contain the complete reciprocal decision set for ${existing.lemma}`);
    }
    if (
      outcome.selectedSenseId !== null
      && !selectedSenseIdsFromEvidence(existing, outcome.dictionaryEvidence).has(outcome.selectedSenseId)
    ) {
      throw new Error(`Selected sense is not present in supplied dictionary evidence: ${existing.lemma}`);
    }
    let candidate = importVerificationEvidence(
      existing,
      outcome.dictionaryEvidence,
      outcome.selectedSenseId,
      outcome.selectedExample,
    );
    candidate = withSenseStatuses(candidate, outcome.selectedSenseId, publish);
    candidate = {
      ...candidate,
      status: outcome.dictionaryEvidence.length > 0 || publish ? "enriched" : candidate.status,
      publicationStatus: publish ? "published" : "hidden",
    };
    byLemma.set(candidate.lemma, candidate);

    const seenRelationships = new Set<string>();
    for (const relationship of outcome.relationships) {
      const key = relationshipKey(relationship);
      if (seenRelationships.has(key)) {
        throw new Error(`Duplicate reciprocal relationship outcome for ${candidate.lemma}/${relationship.coreLemma}`);
      }
      seenRelationships.add(key);

      const core = byLemma.get(relationship.coreLemma);
      if (!core) throw new Error(`Missing core record: ${relationship.coreLemma}`);
      if (core.tier !== "core") {
        throw new Error(`Core identity mismatch for ${relationship.coreLemma}: expected core tier`);
      }

      const candidateIndex = requireUniqueConnection(candidate, {
        target: core.lemma,
        type: relationship.candidateType,
        gloss: relationship.candidateGloss,
      }, "candidate");
      const coreIndex = requireUniqueConnection(core, {
        target: candidate.lemma,
        type: relationship.coreType,
        gloss: relationship.coreGloss,
      }, "core");
      const nextStatus = relationship.decision === "supported" ? "published" : "unreviewed";
      const wasDowngraded = nextStatus === "unreviewed" && (
        candidate.connections[candidateIndex]!.status !== "unreviewed"
        || core.connections[coreIndex]!.status !== "unreviewed"
      );

      candidate = replaceConnectionStatus(candidate, candidateIndex, nextStatus);
      byLemma.set(candidate.lemma, candidate);
      byLemma.set(core.lemma, replaceConnectionStatus(core, coreIndex, nextStatus));
      if (wasDowngraded) downgradedRelationshipCount += 1;
    }

    if (publish) {
      if (outcome.selectedSenseId === null) {
        throw new Error(`Selected sense is required for publication: ${candidate.lemma}`);
      }
      proposedPublished.set(candidate.lemma, outcome.selectedSenseId);
    }
  }

  const proposed = original.map((record) => {
    const next = byLemma.get(record.lemma);
    if (!next) throw new Error(`Proposed snapshot lost record: ${record.lemma}`);
    return VocabularyRecordSchema.parse(next);
  });

  for (const [lemma, selectedSenseId] of proposedPublished) {
    const candidate = proposed.find((record) => record.lemma === lemma)!;
    const selectedSense = candidate.senses.find((sense) => sense.id === selectedSenseId);
    if (!selectedSense) throw new Error(`Selected sense not found for publication: ${lemma}`);
    if (!isSensePublishable(candidate, selectedSense)) {
      throw new Error(`Selected sense does not satisfy publication requirements: ${lemma}`);
    }
    if (publicationStatusFor(candidate, proposed) !== "published") {
      throw new Error(`Final publication gate rejected candidate: ${lemma}`);
    }
  }

  const updates = proposed.filter((record, index) => changed(original[index]!, record));
  return {
    snapshot: proposed,
    updates,
    publishedLemmas: proposed
      .filter((record) => proposedPublished.has(record.lemma))
      .map((record) => record.lemma),
    downgradedRelationshipCount,
  };
}
