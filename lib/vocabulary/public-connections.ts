import type { VocabularyConnection, VocabularyRecord } from "./schema";

export type PublicConnectionTargets = Iterable<Pick<VocabularyRecord, "lemma" | "publicationStatus">>;

function publicTargetLemmas(records: PublicConnectionTargets): Set<string> {
  const targets = new Set<string>();
  for (const record of records) {
    if (record.publicationStatus === "published") targets.add(record.lemma);
  }
  return targets;
}

/** Returns only learner-safe authored links without normalizing their gloss bytes. */
export function publicConnections(
  record: Pick<VocabularyRecord, "connections">,
  records: PublicConnectionTargets,
): VocabularyConnection[] {
  const targets = publicTargetLemmas(records);
  return record.connections.filter((connection) =>
    connection.status === "published"
    && Boolean(connection.gloss?.trim())
    && targets.has(connection.target),
  );
}

export type ClusteringConnectionOptions = {
  /** Temporary migration escape hatch for pre-review clustering only. Defaults to false. */
  includeLegacyUnreviewedForClustering?: boolean;
};

/** Graphs normally see public links; migration can explicitly include legacy reviewed targets. */
export function connectionsForClustering(
  record: Pick<VocabularyRecord, "connections">,
  records: PublicConnectionTargets,
  options: ClusteringConnectionOptions = {},
): VocabularyConnection[] {
  const publicLinks = publicConnections(record, records);
  if (!options.includeLegacyUnreviewedForClustering) return publicLinks;
  const targets = publicTargetLemmas(records);
  return [
    ...publicLinks,
    ...record.connections.filter((connection) => connection.status === "unreviewed" && targets.has(connection.target)),
  ];
}
