import { createHash } from "node:crypto";
import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { sourceRegistry, convertLegacyMarkdown } from "../lib/vocabulary/migrate-markdown";
import { writeVocabularyRecords } from "../lib/vocabulary/ndjson-repository";
import { VocabularyRecordSchema, type ContentSourceRef, type VocabularyRecord } from "../lib/vocabulary/schema";

const SHARD_IDS = Array.from({ length: 32 }, (_, index) => index.toString(16).padStart(2, "0"));

type Arguments = { source: string; out: string; force: boolean };

function parseArguments(arguments_: string[]): Arguments {
  const parsed: Arguments = { source: "wiki/pages", out: "content/vocabulary", force: false };
  for (const argument of arguments_) {
    if (argument === "--force") parsed.force = true;
    else if (argument.startsWith("--source=")) parsed.source = argument.slice("--source=".length);
    else if (argument.startsWith("--out=")) parsed.out = argument.slice("--out=".length);
    else throw new Error(`Unknown argument: ${argument}`);
  }
  return parsed;
}

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

async function createManifest(output: string, records: VocabularyRecord[]) {
  const registry = sourceRegistry(records.flatMap(sourceIds));
  const factualSources = new Set(registry.filter((source) => source.factual).map((source) => source.id));
  const shards = Object.fromEntries(await Promise.all(SHARD_IDS.map(async (id) => {
    const bytes = await readFile(path.join(output, `${id}.ndjson`), "utf8");
    return [id, {
      records: bytes.trimEnd() ? bytes.trimEnd().split("\n").length : 0,
      bytes: Buffer.byteLength(bytes),
      sha256: sha256(bytes),
    }];
  })));
  const perList = Object.fromEntries([...new Set(records.flatMap((record) => record.lists.map((list) => list.id)))].sort()
    .map((id) => [id, records.filter((record) => record.lists.some((list) => list.id === id)).length]));
  const publication = Object.fromEntries(["draft", "review", "published", "hidden"].map((status) => [
    status,
    records.filter((record) => record.publicationStatus === status).length,
  ]));
  const manifest = {
    schemaVersion: 1,
    generatedFrom: "wiki/pages",
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

async function main(): Promise<void> {
  const arguments_ = parseArguments(process.argv.slice(2));
  const source = path.resolve(arguments_.source);
  const output = path.resolve(arguments_.out);
  await ensureOutputDirectory(output, arguments_.force);

  const files = (await readdir(source)).filter((file) => file.endsWith(".md")).sort();
  const records: VocabularyRecord[] = [];
  const seen = new Set<string>();
  for (const file of files) {
    const raw = await readFile(path.join(source, file), "utf8");
    const record = convertLegacyMarkdown(raw);
    if (!record) throw new Error(`Cannot convert legacy Markdown page: ${path.join(source, file)}`);
    if (seen.has(record.lemma)) throw new Error(`Duplicate legacy lemma: ${record.lemma}`);
    seen.add(record.lemma);
    records.push(record);
  }

  await writeVocabularyRecords(output, records);
  const generatedShards = (await readdir(output)).filter((file) => /^([0-1][0-9a-f])\.ndjson$/.test(file));
  if (generatedShards.length !== SHARD_IDS.length) throw new Error(`Expected 32 output shards, found ${generatedShards.length}`);
  const schema = JSON.stringify(VocabularyRecordSchema.toJSONSchema(), null, 2);
  await writeFile(path.join(output, "schema.json"), `${schema}\n`, "utf8");
  const manifest = await createManifest(output, records);
  console.log(`Migrated ${manifest.totals.records} records across ${SHARD_IDS.length} shards with ${manifest.totals.connections} connections.`);
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
