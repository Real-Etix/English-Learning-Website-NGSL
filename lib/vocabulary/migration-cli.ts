import { createHash } from "node:crypto";
import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { sourceRegistry, convertLegacyMarkdown } from "./migrate-markdown";
import { writeVocabularyRecords } from "./ndjson-repository";
import { VocabularyRecordSchema, type ContentSourceRef, type VocabularyRecord } from "./schema";

export const VOCABULARY_SHARD_IDS = Array.from({ length: 32 }, (_, index) => index.toString(16).padStart(2, "0"));

export type MigrationOptions = {
  sourceDirectory: string;
  outputDirectory: string;
  force: boolean;
  generatedFrom?: string;
};

export type VocabularyManifest = {
  schemaVersion: 1;
  generatedFrom: string;
  totals: {
    records: number;
    connections: number;
    perList: Record<string, number>;
    publication: Record<string, number>;
    sourceBacked: number;
  };
  shards: Record<string, { records: number; bytes: number; sha256: string }>;
};

function sourceIds(record: VocabularyRecord): string[] {
  const collect = (sources: ContentSourceRef[]) => sources.map((source) => source.sourceId);
  return [
    ...collect(record.sources),
    ...record.senses.flatMap((sense) => [
      ...collect(sense.sources),
      ...sense.examples.flatMap((example) => collect(example.sources)),
      ...sense.usagePatterns.flatMap((pattern) => collect(pattern.sources)),
      ...sense.collocations.flatMap((collocation) => collect(collocation.sources)),
      ...sense.commonMistakes.flatMap((mistake) => collect(mistake.sources)),
    ]),
    ...record.pronunciation.flatMap((pronunciation) => collect(pronunciation.sources)),
    ...record.connections.flatMap((connection) => collect(connection.sources)),
  ];
}

function sha256(bytes: string): string {
  return createHash("sha256").update(bytes, "utf8").digest("hex");
}

function sourceBacked(record: VocabularyRecord, factualSources: Set<string>): boolean {
  return sourceIds(record).some((id) => factualSources.has(id));
}

async function createManifest(output: string, records: VocabularyRecord[], generatedFrom: string): Promise<VocabularyManifest> {
  const registry = sourceRegistry(records.flatMap(sourceIds));
  const factualSources = new Set(registry.filter((source) => source.factual).map((source) => source.id));
  const shards = Object.fromEntries(await Promise.all(VOCABULARY_SHARD_IDS.map(async (id) => {
    const bytes = await readFile(path.join(output, `${id}.ndjson`), "utf8");
    return [id, {
      records: bytes.trimEnd() ? bytes.trimEnd().split("\n").length : 0,
      bytes: Buffer.byteLength(bytes),
      sha256: sha256(bytes),
    }];
  }))) as VocabularyManifest["shards"];
  const perList = Object.fromEntries([...new Set(records.flatMap((record) => record.lists.map((list) => list.id)))].sort()
    .map((id) => [id, records.filter((record) => record.lists.some((list) => list.id === id)).length]));
  const publication = Object.fromEntries(["draft", "review", "published", "hidden"].map((status) => [
    status,
    records.filter((record) => record.publicationStatus === status).length,
  ]));
  const manifest: VocabularyManifest = {
    schemaVersion: 1,
    generatedFrom,
    totals: {
      records: records.length,
      connections: records.reduce((total, record) => total + record.connections.length, 0),
      perList,
      publication,
      sourceBacked: records.filter((record) => sourceBacked(record, factualSources)).length,
    },
    shards,
  };
  await writeFile(path.join(output, "sources.json"), `${JSON.stringify({ schemaVersion: 1, sources: registry }, null, 2)}\n`, "utf8");
  await writeFile(path.join(output, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  return manifest;
}

async function ensureOutputDirectory(output: string, force: boolean): Promise<void> {
  const existing = await readdir(output).catch((error: unknown) => {
    if (typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT") return [] as string[];
    throw error;
  });
  if (existing.length && !force) {
    throw new Error(`Refusing to overwrite non-empty output directory ${output}; pass --force to replace it.`);
  }
  if (force && existing.length) await rm(output, { recursive: true, force: true });
  await mkdir(output, { recursive: true });
}

/** Runs the guarded migration; the CLI and focused tests share this exact implementation. */
export async function migrateVocabularyCorpus(options: MigrationOptions): Promise<VocabularyManifest> {
  const { sourceDirectory, outputDirectory, force, generatedFrom = "wiki/pages" } = options;
  await ensureOutputDirectory(outputDirectory, force);
  await Promise.all(VOCABULARY_SHARD_IDS.map((id) => writeFile(path.join(outputDirectory, `${id}.ndjson`), "", { flag: "a" })));
  const files = (await readdir(sourceDirectory)).filter((file) => file.endsWith(".md")).sort();
  const records: VocabularyRecord[] = [];
  const seen = new Set<string>();
  for (const file of files) {
    const raw = await readFile(path.join(sourceDirectory, file), "utf8");
    const record = convertLegacyMarkdown(raw);
    if (!record) throw new Error(`Cannot convert legacy Markdown page: ${path.join(sourceDirectory, file)}`);
    if (seen.has(record.lemma)) throw new Error(`Duplicate legacy lemma: ${record.lemma}`);
    seen.add(record.lemma);
    records.push(record);
  }

  await writeVocabularyRecords(outputDirectory, records);
  const generatedShards = (await readdir(outputDirectory)).filter((file) => /^([0-1][0-9a-f])\.ndjson$/.test(file));
  if (generatedShards.length !== VOCABULARY_SHARD_IDS.length) {
    throw new Error(`Expected 32 output shards, found ${generatedShards.length}`);
  }
  await writeFile(path.join(outputDirectory, "schema.json"), `${JSON.stringify(VocabularyRecordSchema.toJSONSchema(), null, 2)}\n`, "utf8");
  return createManifest(outputDirectory, records, generatedFrom);
}
