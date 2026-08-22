import { readFile as nodeReadFile } from "node:fs/promises";
import { join } from "node:path";

import { VocabularyRecordSchema, type VocabularyRecord } from "./schema";
import { normalizeVocabularyLemma, shardIdForLemma } from "./shards";

type ReadFile = (path: string, encoding: "utf8") => Promise<string>;

type GeneratedShard = Record<string, VocabularyRecord>;

const generatedRoot = join(process.cwd(), "data", "generated", "vocabulary");
const lemmaPattern = /^[a-z]+(?:[ '-][a-z]+)*$/;

function shardPath(root: string, shardId: string): string {
  return join(root, `words-${shardId}.json`);
}

function isMissingFile(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}

function decodeShard(text: string, filePath: string): GeneratedShard {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`Invalid generated vocabulary shard ${filePath}: ${detail}`, { cause: error });
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error(`Invalid generated vocabulary shard ${filePath}: expected an object keyed by lemma`);
  }

  const records: GeneratedShard = {};
  for (const [lemma, value] of Object.entries(parsed)) {
    try {
      const record = VocabularyRecordSchema.parse(value);
      if (record.lemma !== lemma) throw new Error(`key ${lemma} does not match record lemma ${record.lemma}`);
      records[lemma] = record;
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      throw new Error(`Invalid generated vocabulary record in ${filePath} for ${lemma}: ${detail}`, { cause: error });
    }
  }
  return records;
}

export function createGeneratedWordStore(root = generatedRoot, readFile: ReadFile = nodeReadFile) {
  const cache = new Map<string, Promise<GeneratedShard>>();

  const loadShard = (shardId: string): Promise<GeneratedShard> => {
    const existing = cache.get(shardId);
    if (existing) return existing;
    const filePath = shardPath(root, shardId);
    const loaded = readFile(filePath, "utf8")
      .then((text) => decodeShard(text, filePath))
      .catch((error) => {
        if (isMissingFile(error)) return {};
        throw error;
      });
    cache.set(shardId, loaded);
    return loaded;
  };

  return {
    async get(lemma: string): Promise<VocabularyRecord | null> {
      const normalized = normalizeVocabularyLemma(lemma);
      if (!normalized || !lemmaPattern.test(normalized)) return null;
      return (await loadShard(shardIdForLemma(normalized)))[normalized] ?? null;
    },
  };
}

const generatedWordStore = createGeneratedWordStore();

export function loadGeneratedWord(lemma: string): Promise<VocabularyRecord | null> {
  return generatedWordStore.get(lemma);
}
