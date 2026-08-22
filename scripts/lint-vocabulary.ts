/**
 * Deterministic health checks for the canonical vocabulary corpus.
 * Usage: tsx scripts/lint-vocabulary.ts
 */
import { readFile } from "node:fs/promises";
import path from "node:path";

import { openNdjsonRepository } from "../lib/vocabulary/ndjson-repository";
import { VocabularyRecordSchema, type ContentSourceRef, type VocabularyRecord } from "../lib/vocabulary/schema";
import { shardIdForLemma } from "../lib/vocabulary/shards";

const ALLOWED_EDGES = new Set([
  "synonym", "antonym", "intensity", "builds_on", "advanced_form", "morphological", "collocation",
]);

export type Finding = { level: "error" | "warn"; lemma: string; message: string };

const SHARD_IDS = Array.from({ length: 32 }, (_, index) => index.toString(16).padStart(2, "0"));

function compareFindings(left: Finding, right: Finding): number {
  return left.lemma < right.lemma ? -1 : left.lemma > right.lemma ? 1 : left.message < right.message ? -1 : left.message > right.message ? 1 : 0;
}

function isMissingFile(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}

/** Reports records stored outside the physical shard calculated from their canonical lemma. */
export async function findMisplacedShardFindings(root: string): Promise<Finding[]> {
  const findings: Finding[] = [];
  for (const actualShard of SHARD_IDS) {
    const filePath = path.join(root, `${actualShard}.ndjson`);
    let text: string;
    try {
      text = await readFile(filePath, "utf8");
    } catch (error) {
      if (isMissingFile(error)) continue;
      throw error;
    }
    for (const [index, line] of text.split("\n").entries()) {
      if (!line.trim()) continue;
      let record: VocabularyRecord;
      try {
        record = VocabularyRecordSchema.parse(JSON.parse(line));
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        throw new Error(`Invalid vocabulary record in ${filePath}:${index + 1}: ${detail}`, { cause: error });
      }
      const expectedShard = shardIdForLemma(record.lemma);
      if (actualShard !== expectedShard) {
        findings.push({
          level: "error",
          lemma: record.lemma,
          message: `stored in ${actualShard}.ndjson; expected ${expectedShard}.ndjson`,
        });
      }
    }
  }
  return findings.sort(compareFindings);
}

function sourceReferences(record: VocabularyRecord): ContentSourceRef[] {
  return [
    ...record.sources,
    ...record.senses.flatMap((sense) => [
      ...sense.sources,
      ...sense.examples.flatMap((example) => example.sources),
      ...sense.usagePatterns.flatMap((pattern) => [...pattern.sources, ...pattern.examples.flatMap((example) => example.sources)]),
      ...sense.collocations.flatMap((collocation) => collocation.sources),
      ...sense.commonMistakes.flatMap((mistake) => mistake.sources),
    ]),
    ...record.pronunciation.flatMap((pronunciation) => pronunciation.sources),
    ...record.connections.flatMap((connection) => connection.sources),
  ];
}

async function knownSourceIds(): Promise<Set<string>> {
  const file = path.join(process.cwd(), "content", "vocabulary", "sources.json");
  const parsed = JSON.parse(await readFile(file, "utf8")) as { sources?: Array<{ id?: string }> };
  return new Set(parsed.sources?.flatMap((source) => source.id ? [source.id] : []) ?? []);
}

/** Lints deterministic corpus relationships without touching the filesystem. */
export function lintVocabularyRecords(records: VocabularyRecord[]): Finding[] {
  const findings: Finding[] = [];
  const byLemma = new Map<string, VocabularyRecord>();
  for (const record of records) {
    if (byLemma.has(record.lemma)) findings.push({ level: "error", lemma: record.lemma, message: "duplicate lemma" });
    byLemma.set(record.lemma, record);
    const listIds = record.lists.map((membership) => membership.id);
    if (new Set(listIds).size !== listIds.length) findings.push({ level: "error", lemma: record.lemma, message: "duplicate list membership" });
  }

  const hasEdge = (from: string, type: string, to: string) => byLemma.get(from)?.connections.some((connection) => connection.type === type && connection.target === to) ?? false;
  for (const record of records) {
    for (const connection of record.connections) {
      if (!ALLOWED_EDGES.has(connection.type)) {
        findings.push({ level: "error", lemma: record.lemma, message: `unknown edge type "${connection.type}" → ${connection.target}` });
        continue;
      }
      const target = byLemma.get(connection.target);
      if (connection.status === "published" && !connection.gloss?.trim()) {
        findings.push({ level: "error", lemma: record.lemma, message: `published connection to [[${connection.target}]] needs a gloss` });
      }
      if (connection.status === "published" && target?.publicationStatus !== "published") {
        findings.push({ level: "error", lemma: record.lemma, message: `published connection targets non-public word [[${connection.target}]]` });
      }
      if (!target) {
        findings.push({ level: "error", lemma: record.lemma, message: `${connection.type} dangling target [[${connection.target}]]` });
        continue;
      }
      if (connection.type === "builds_on" && !hasEdge(connection.target, "advanced_form", record.lemma)) {
        findings.push({ level: "error", lemma: record.lemma, message: `builds_on [[${connection.target}]] has no reciprocal advanced_form` });
      }
      if (connection.type === "advanced_form" && !hasEdge(connection.target, "builds_on", record.lemma)) {
        findings.push({ level: "error", lemma: record.lemma, message: `advanced_form [[${connection.target}]] has no reciprocal builds_on` });
      }
    }
    if (record.tier === "advanced") {
      const anchors = record.connections.filter((connection) => connection.type === "builds_on");
      if (anchors.length === 0) findings.push({ level: "error", lemma: record.lemma, message: "advanced record has no builds_on anchor" });
      else if (!anchors.some((anchor) => byLemma.get(anchor.target)?.tier === "core")) findings.push({ level: "error", lemma: record.lemma, message: "builds_on target is not a core record" });
    }
  }
  return findings.sort(compareFindings);
}

async function main(): Promise<void> {
  const root = path.join(process.cwd(), "content", "vocabulary");
  const sources = await knownSourceIds();
  const records: VocabularyRecord[] = [];
  for await (const record of openNdjsonRepository(root).all()) records.push(record);

  const findings: Finding[] = await findMisplacedShardFindings(root);
  findings.push(...lintVocabularyRecords(records));
  for (const record of records) {
    for (const source of sourceReferences(record)) {
      if (!sources.has(source.sourceId)) findings.push({ level: "error", lemma: record.lemma, message: `unknown source ID "${source.sourceId}"` });
    }
  }

  const errors = findings.filter((finding) => finding.level === "error");
  const warnings = findings.filter((finding) => finding.level === "warn");
  console.log(`Linted ${records.length} canonical vocabulary record(s).`);
  for (const finding of findings.sort(compareFindings)) console.log(`  ${finding.level.toUpperCase()} ${finding.lemma}: ${finding.message}`);
  console.log(`${errors.length} error(s), ${warnings.length} warning(s).`);
  if (errors.length > 0) process.exitCode = 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.join(process.cwd(), "scripts", "lint-vocabulary.ts")) {
  void main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
