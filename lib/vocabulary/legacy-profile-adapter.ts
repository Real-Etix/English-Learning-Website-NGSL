import type { VocabularyConnection, VocabularyRecord } from "./schema";
import { publicConnections } from "./public-connections";

/**
 * Compatibility projection returned by the word endpoint while clients consume
 * the former page-shaped payload. It is derived from canonical NDJSON records;
 * it is not a Markdown parser contract.
 */
export type LegacyWordConnection = { type: string; target: string; gloss?: string };

export type LegacyWordPage = {
  lemma: string;
  display: string;
  tier: "core" | "advanced";
  pos: string;
  rank: number | null;
  sfi: number | null;
  chart: string | null;
  region: string | null;
  lists: string[];
  forms: string[];
  status: string;
  sources: string[];
  definition: string;
  usageNote: string | null;
  examples: string[];
  connections: LegacyWordConnection[];
  domains: string[];
};

const CONNECTION_TYPES = new Set<VocabularyConnection["type"]>([
  "synonym", "antonym", "intensity", "builds_on", "advanced_form", "morphological", "collocation",
]);

function sourceRefs(sourceIds: string[]) {
  return sourceIds.map((sourceId) => ({ sourceId, externalId: null, url: null, retrievedAt: null, contentHash: null }));
}

/** Temporary API response projection while clients still expect the former page-shaped payload. */
export function toLegacyPage(record: VocabularyRecord, knownRecords: Iterable<VocabularyRecord>): LegacyWordPage {
  const primarySense = record.senses[0];
  const primaryMembership = record.lists[0];
  return {
    lemma: record.lemma,
    display: record.display,
    tier: record.tier,
    pos: primarySense?.partOfSpeech ?? record.partOfSpeech,
    rank: primaryMembership?.rank ?? null,
    sfi: primaryMembership?.sfi ?? null,
    chart: record.chart,
    region: record.region,
    lists: record.lists.map(({ id }) => id),
    forms: record.forms,
    status: record.status,
    sources: record.sources.map(({ sourceId }) => sourceId),
    definition: primarySense?.definition ?? "",
    usageNote: record.usageNote,
    examples: primarySense?.examples.map(({ text }) => text) ?? [],
    connections: publicConnections(record, knownRecords).map(({ type, target, gloss }) => ({
      type,
      target,
      ...(gloss === null ? {} : { gloss }),
    })),
    domains: record.domains,
  };
}

/** Converts the temporary legacy response shape back to the canonical learning input. */
export function toCanonicalRecord(page: LegacyWordPage): VocabularyRecord {
  const sources = sourceRefs(page.sources);
  const connections: VocabularyRecord["connections"] = page.connections
    .filter((connection): connection is LegacyWordConnection & { type: VocabularyConnection["type"] } => CONNECTION_TYPES.has(connection.type as VocabularyConnection["type"]))
    .map((connection) => ({
      target: connection.target,
      type: connection.type,
      gloss: connection.gloss ?? null,
      sources,
      status: connection.gloss?.trim() ? "published" : "unreviewed",
    }));

  return {
    schemaVersion: 1,
    lemma: page.lemma,
    display: page.display,
    tier: page.tier,
    partOfSpeech: page.pos,
    forms: page.forms,
    lists: page.lists.map((id) => ({ id, rank: page.rank, sfi: page.sfi })),
    status: page.status === "verified" || page.status === "enriched" ? page.status : "seeded",
    publicationStatus: "published",
    sources,
    senses: [{
      id: `legacy:${page.lemma}`,
      partOfSpeech: page.pos,
      definition: page.definition,
      labels: [],
      sources,
      examples: page.examples.map((text) => ({ text, sources })),
      usagePatterns: [],
      collocations: [],
      commonMistakes: [],
      status: "published",
    }],
    pronunciation: [],
    usageNote: page.usageNote,
    connections,
    domains: page.domains,
    chart: page.chart,
    region: page.region,
  };
}
