import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { openNdjsonRepository } from "../lib/vocabulary/ndjson-repository";
import { isWordPublic } from "../lib/vocabulary/publication";
import type { VocabularyRecord } from "../lib/vocabulary/schema";
import { shardIdForLemma } from "../lib/vocabulary/shards";

const SHARD_IDS = Array.from({ length: 32 }, (_, index) => index.toString(16).padStart(2, "0"));

function compareRecords(left: VocabularyRecord, right: VocabularyRecord): number {
  return left.lemma < right.lemma ? -1 : left.lemma > right.lemma ? 1 : 0;
}

function hash(bytes: string): string {
  return createHash("sha256").update(bytes, "utf8").digest("hex");
}

async function main() {
  const recordsByShard = new Map(SHARD_IDS.map((shardId) => [shardId, [] as VocabularyRecord[]]));
  const records: VocabularyRecord[] = [];
  for await (const record of openNdjsonRepository().all()) records.push(record);
  for (const record of records) {
    if (!isWordPublic(record, records)) continue;
    recordsByShard.get(shardIdForLemma(record.lemma))?.push(record);
  }

  const root = path.join(process.cwd(), "data", "generated", "vocabulary");
  await mkdir(root, { recursive: true });
  const shards: Record<string, { records: number; bytes: number; sha256: string }> = {};
  let recordCount = 0;
  for (const shardId of SHARD_IDS) {
    const records = recordsByShard.get(shardId)!.sort(compareRecords);
    const output = JSON.stringify(Object.fromEntries(records.map((record) => [record.lemma, record])));
    await writeFile(path.join(root, `words-${shardId}.json`), output, "utf8");
    shards[shardId] = { records: records.length, bytes: Buffer.byteLength(output), sha256: hash(output) };
    recordCount += records.length;
  }

  await writeFile(
    path.join(root, "manifest.json"),
    JSON.stringify({ schemaVersion: 1, generatedFrom: "content/vocabulary", records: recordCount, shards }),
    "utf8",
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
