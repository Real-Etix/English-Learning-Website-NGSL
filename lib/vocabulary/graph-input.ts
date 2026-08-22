import type { VocabularyRecord } from "./schema";
import { isLearnerConnection, isWordPublic } from "./publication";

export type GraphConnection = {
  target: string;
  type: string;
};

export type GraphMembership = {
  id: string;
  rank: number | null;
  sfi: number | null;
};

/** The graph-only projection of one canonical vocabulary record. */
export type GraphInput = {
  lemma: string;
  display: string;
  tier: "core" | "advanced";
  partOfSpeech: string;
  definition: string;
  memberships: GraphMembership[];
  chart: string | null;
  region: string | null;
  domains: string[];
  connections: GraphConnection[];
};

/**
 * Selects only graph-relevant canonical fields. This is deliberately pure: it
 * does not read files or mutate a record, so all storage backends can feed the
 * same graph builder.
 */
export function toGraphInput(record: VocabularyRecord): GraphInput {
  const primarySense = record.senses[0];
  return {
    lemma: record.lemma,
    display: record.display,
    tier: record.tier,
    partOfSpeech: primarySense?.partOfSpeech ?? record.partOfSpeech,
    definition: primarySense?.definition ?? "",
    memberships: record.lists.map(({ id, rank, sfi }) => ({ id, rank, sfi })),
    chart: record.chart,
    region: record.region,
    domains: [...record.domains],
    connections: record.connections.filter(isLearnerConnection).map(({ target, type }) => ({ target, type })),
  };
}

/** Projects only records that satisfy the publication predicate. */
export function toPublicGraphInputs(records: VocabularyRecord[]): GraphInput[] {
  return records.filter((record) => isWordPublic(record, records)).map(toGraphInput);
}
