/**
 * Deterministic health checks for the canonical vocabulary corpus.
 * Usage: tsx scripts/lint-vocabulary.ts
 */
import { readFile } from "node:fs/promises";
import path from "node:path";

import { openNdjsonRepository } from "../lib/vocabulary/ndjson-repository";
import type { ContentSourceRef, VocabularyRecord } from "../lib/vocabulary/schema";
import { shardIdForLemma } from "../lib/vocabulary/shards";

const ALLOWED_EDGES = new Set([
  "synonym", "antonym", "intensity", "builds_on", "advanced_form", "morphological", "collocation",
]);

type Finding = { level: "error" | "warn"; lemma: string; message: string };

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

async function main(): Promise<void> {
  const root = path.join(process.cwd(), "content", "vocabulary");
  const sources = await knownSourceIds();
  const records: VocabularyRecord[] = [];
  for await (const record of openNdjsonRepository(root).all()) records.push(record);

  const byLemma = new Map<string, VocabularyRecord>();
  const findings: Finding[] = [];
  for (const record of records) {
    if (byLemma.has(record.lemma)) findings.push({ level: "error", lemma: record.lemma, message: "duplicate lemma" });
    byLemma.set(record.lemma, record);
    if (shardIdForLemma(record.lemma) === "") findings.push({ level: "error", lemma: record.lemma, message: "invalid shard placement" });
    const listIds = record.lists.map((membership) => membership.id);
    if (new Set(listIds).size !== listIds.length) findings.push({ level: "error", lemma: record.lemma, message: "duplicate list membership" });
    for (const source of sourceReferences(record)) {
      if (!sources.has(source.sourceId)) findings.push({ level: "error", lemma: record.lemma, message: `unknown source ID "${source.sourceId}"` });
    }
  }

  const hasEdge = (from: string, type: string, to: string) => byLemma.get(from)?.connections.some((connection) => connection.type === type && connection.target === to) ?? false;
  for (const record of records) {
    for (const connection of record.connections) {
      if (!ALLOWED_EDGES.has(connection.type)) {
        findings.push({ level: "error", lemma: record.lemma, message: `unknown edge type "${connection.type}" → ${connection.target}` });
        continue;
      }
      if (!byLemma.has(connection.target)) {
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

  const errors = findings.filter((finding) => finding.level === "error");
  const warnings = findings.filter((finding) => finding.level === "warn");
  console.log(`Linted ${records.length} canonical vocabulary record(s).`);
  for (const finding of findings) console.log(`  ${finding.level.toUpperCase()} ${finding.lemma}: ${finding.message}`);
  console.log(`${errors.length} error(s), ${warnings.length} warning(s).`);
  if (errors.length > 0) process.exitCode = 1;
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
