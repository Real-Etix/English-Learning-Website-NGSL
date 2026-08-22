import path from "node:path";

import { openNdjsonRepository, writeVocabularyRecords } from "../lib/vocabulary/ndjson-repository";
import { publicationStatusFor } from "../lib/vocabulary/publication";
import type { VocabularyRecord } from "../lib/vocabulary/schema";

export type QuarantineSummary = {
  total: number;
  changes: number;
  byList: Record<string, number>;
  lemmas: string[];
  changedShards: string[];
};

export async function runQuarantineAdvancedDrafts({
  root = path.join(process.cwd(), "content", "vocabulary"),
  write,
}: {
  root?: string;
  write: boolean;
}): Promise<QuarantineSummary> {
  const records: VocabularyRecord[] = [];
  for await (const record of openNdjsonRepository(root).all()) records.push(record);

  const candidates = records.filter((record) => publicationStatusFor(record, records) === "hidden" && record.tier === "advanced");
  const updates = candidates
    .filter((record) => record.publicationStatus !== "hidden")
    .map((record) => ({ ...record, publicationStatus: "hidden" as const }));
  const byList: Record<string, number> = {};
  for (const record of candidates) {
    for (const { id } of record.lists) byList[id] = (byList[id] ?? 0) + 1;
  }

  return {
    total: candidates.length,
    changes: updates.length,
    byList: Object.fromEntries(Object.entries(byList).sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)),
    lemmas: candidates.map((record) => record.lemma).sort(),
    changedShards: write ? await writeVocabularyRecords(root, updates) : [],
  };
}

function printSummary(summary: QuarantineSummary, write: boolean): void {
  console.log(`${write ? "Write" : "Dry run"}: ${summary.total} unsupported advanced record(s); ${summary.changes} change(s).`);
  console.log(`Per list: ${Object.entries(summary.byList).map(([id, count]) => `${id}=${count}`).join(", ") || "none"}`);
  console.log(`Lemmas: ${summary.lemmas.join(", ") || "none"}`);
  if (write) console.log(`Changed shards: ${summary.changedShards.join(", ") || "none"}`);
}

async function main(): Promise<void> {
  const write = process.argv.slice(2).includes("--write");
  printSummary(await runQuarantineAdvancedDrafts({ write }), write);
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.join(process.cwd(), "scripts", "quarantine-advanced-drafts.ts")) {
  void main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
