import { VocabularyRecordSchema, type VocabularyConnection, type VocabularyRecord } from "../schema";
import { normalizeVocabularyLemma } from "../shards";

const CONNECTION_TYPES = new Set<VocabularyConnection["type"]>([
  "synonym",
  "antonym",
  "intensity",
  "builds_on",
  "advanced_form",
  "morphological",
  "collocation",
]);

type ConnectionProposal = {
  kind: "connection";
  lemma: string;
  target: string;
  type: VocabularyConnection["type"];
  gloss: string;
  sourceId: "llm";
};

type DefinitionProposal = {
  kind: "definition";
  lemma: string;
  definition: string;
  sourceId: "llm";
};

export type VocabularyProposal = ConnectionProposal | DefinitionProposal;

export type ProposalRejection = { lemma: string; reason: string };

export type ApplyProposalResult = {
  records: VocabularyRecord[];
  changed: VocabularyRecord[];
  rejected: ProposalRejection[];
};

function sourceRef(sourceId: "llm") {
  return { sourceId, externalId: null, url: null, retrievedAt: null, contentHash: null };
}

/**
 * Applies only safe, existing-record connection proposals. This function has no
 * filesystem effects so callers can validate and review updates before writing
 * canonical shards.
 */
export function applyVocabularyProposals(
  records: VocabularyRecord[],
  proposals: VocabularyProposal[],
): ApplyProposalResult {
  const updated = new Map(records.map((record) => [record.lemma, record]));
  const changed = new Map<string, VocabularyRecord>();
  const rejected: ProposalRejection[] = [];

  for (const proposal of proposals) {
    const lemma = normalizeVocabularyLemma(proposal.lemma);
    const record = updated.get(lemma);
    if (!record) {
      rejected.push({ lemma, reason: "unknown lemma" });
      continue;
    }
    if (proposal.sourceId !== "llm") {
      rejected.push({ lemma, reason: `unsupported source: ${proposal.sourceId}` });
      continue;
    }

    if (proposal.kind === "definition") {
      rejected.push({ lemma, reason: record.status === "verified" ? "verified definition" : "definition proposals are not supported" });
      continue;
    }

    const target = normalizeVocabularyLemma(proposal.target);
    if (!updated.has(target)) {
      rejected.push({ lemma, reason: `unknown target: ${target}` });
      continue;
    }
    if (!CONNECTION_TYPES.has(proposal.type)) {
      rejected.push({ lemma, reason: `unsupported connection type: ${proposal.type}` });
      continue;
    }
    if (!proposal.gloss.trim()) {
      rejected.push({ lemma, reason: "blank gloss" });
      continue;
    }

    const exists = record.connections.some((connection) => connection.target === target && connection.type === proposal.type);
    if (exists) continue;

    const next = VocabularyRecordSchema.parse({
      ...record,
      connections: [
        ...record.connections,
        {
          target,
          type: proposal.type,
          gloss: proposal.gloss,
          sources: [sourceRef("llm")],
          status: "unreviewed",
        },
      ],
    });
    updated.set(lemma, next);
    changed.set(lemma, next);
  }

  return {
    records: records.map((record) => updated.get(record.lemma) ?? record),
    changed: [...changed.values()],
    rejected,
  };
}
