import { releaseRecordHash } from "./limited-release";
import type { VocabularyRecord } from "./schema";

export type RetirementDecision = { lemma: string; beforeHash: string; reason: string };
export type RetiredIncomingConnection = {
  lemma: string;
  index: number;
  connection: VocabularyRecord["connections"][number];
};

/** Pure migration plan. The caller must persist a verified recovery copy first. */
export function planRetirement(records: VocabularyRecord[], decisions: RetirementDecision[]) {
  const byId = new Map(records.map(record => [record.lemma, record]));
  if (byId.size !== records.length) throw new Error("Duplicate corpus identity");
  const targets = new Set<string>();
  for (const decision of decisions) {
    if (targets.has(decision.lemma)) throw new Error(`Duplicate retirement: ${decision.lemma}`);
    const record = byId.get(decision.lemma);
    if (!record) throw new Error(`Missing retirement target: ${decision.lemma}`);
    if (record.tier !== "advanced" || record.publicationStatus !== "hidden" || record.lists.length) {
      throw new Error(`Expected hidden advanced word without official membership: ${record.lemma}`);
    }
    if (!decision.reason.trim() || releaseRecordHash(record) !== decision.beforeHash) {
      throw new Error(`Changed or unreviewed retirement target: ${record.lemma}`);
    }
    targets.add(record.lemma);
  }
  const incoming: RetiredIncomingConnection[] = [];
  const retained: VocabularyRecord[] = [];
  const retired: VocabularyRecord[] = [];
  for (const record of records) {
    for (const connection of record.connections) {
      if (targets.has(connection.target) && connection.status === "published") {
        throw new Error(`Published connection targets retirement: ${record.lemma} -> ${connection.target}`);
      }
    }
    if (targets.has(record.lemma)) { retired.push(record); continue; }
    const connections = record.connections.filter((connection, index) => {
      if (!targets.has(connection.target)) return true;
      incoming.push({ lemma: record.lemma, index, connection });
      return false;
    });
    retained.push(connections.length === record.connections.length ? record : { ...record, connections });
  }
  return { retained, retired, incoming };
}
