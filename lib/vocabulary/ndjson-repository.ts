import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { VocabularyRecordSchema, type VocabularyRecord } from "./schema";
import { normalizeVocabularyLemma, shardIdForLemma } from "./shards";
import type { VocabularyRepository } from "./repository";

const SHARD_IDS = Array.from({ length: 32 }, (_, index) => index.toString(16).padStart(2, "0"));

function shardPath(root: string, shardId: string): string {
  return join(root, `${shardId}.ndjson`);
}

function decodeShard(text: string, filePath: string): VocabularyRecord[] {
  const records: VocabularyRecord[] = [];
  for (const [index, line] of text.split("\n").entries()) {
    if (!line.trim()) continue;
    try {
      records.push(VocabularyRecordSchema.parse(JSON.parse(line)));
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      throw new Error(`Invalid vocabulary record in ${filePath}:${index + 1}: ${detail}`, { cause: error });
    }
  }
  return records;
}

async function readShard(root: string, shardId: string): Promise<VocabularyRecord[]> {
  const filePath = shardPath(root, shardId);
  try {
    return decodeShard(await readFile(filePath, "utf8"), filePath);
  } catch (error) {
    if (isMissingFile(error)) return [];
    throw error;
  }
}

function isMissingFile(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}

export function openNdjsonRepository(root = join(process.cwd(), "content", "vocabulary")): VocabularyRepository {
  const cache = new Map<string, Promise<VocabularyRecord[]>>();
  const cachedShard = (shardId: string): Promise<VocabularyRecord[]> => {
    const existing = cache.get(shardId);
    if (existing) return existing;
    const loaded = readShard(root, shardId);
    cache.set(shardId, loaded);
    return loaded;
  };
  const allRecords = async function* (): AsyncGenerator<VocabularyRecord> {
    for (const shardId of SHARD_IDS) {
      for (const record of await cachedShard(shardId)) yield record;
    }
  };

  return {
    async get(lemma) {
      const normalized = normalizeVocabularyLemma(lemma);
      if (!normalized) return undefined;
      return (await cachedShard(shardIdForLemma(normalized))).find((record) => record.lemma === normalized);
    },
    all: allRecords,
    async *list(listId) {
      for await (const record of allRecords()) {
        if (record.lists.some((membership) => membership.id === listId)) yield record;
      }
    },
  };
}

function compareRecords(left: VocabularyRecord, right: VocabularyRecord): number {
  return left.lemma < right.lemma ? -1 : left.lemma > right.lemma ? 1 : 0;
}

export async function writeVocabularyRecords(root: string, updates: VocabularyRecord[]): Promise<string[]> {
  const parsedUpdates = updates.map((record) => VocabularyRecordSchema.parse(record));
  const updateMap = new Map<string, VocabularyRecord>();
  for (const record of parsedUpdates) {
    if (updateMap.has(record.lemma)) throw new Error(`Duplicate vocabulary update lemma: ${record.lemma}`);
    updateMap.set(record.lemma, record);
  }

  const affected = new Map<string, VocabularyRecord[]>();
  for (const record of parsedUpdates) {
    const shardId = shardIdForLemma(record.lemma);
    const records = affected.get(shardId) ?? [];
    records.push(record);
    affected.set(shardId, records);
  }

  await mkdir(root, { recursive: true });
  const changed: string[] = [];
  for (const [shardId, shardUpdates] of affected) {
    const filePath = shardPath(root, shardId);
    const existing = await readShard(root, shardId);
    const records = new Map(existing.map((record) => [record.lemma, record]));
    for (const record of shardUpdates) records.set(record.lemma, record);
    const serialized = [...records.values()].sort(compareRecords).map((record) => `${JSON.stringify(record)}\n`).join("");
    let previous = "";
    try {
      previous = await readFile(filePath, "utf8");
    } catch (error) {
      if (!isMissingFile(error)) throw error;
    }
    if (serialized === previous) continue;

    const tempPath = `${filePath}.tmp-${process.pid}`;
    let renamed = false;
    try {
      await writeFile(tempPath, serialized, "utf8");
      await rename(tempPath, filePath);
      renamed = true;
      changed.push(shardId);
    } finally {
      if (!renamed) await rm(tempPath, { force: true });
    }
  }
  return changed.sort();
}
