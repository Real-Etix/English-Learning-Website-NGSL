import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

import {
  auditDictionaryRecords,
  strictViolationIdentityRegressions,
  strictViolationRegressions,
} from "../lib/wiki/dictionary-quality";
import { openNdjsonRepository, writeVocabularyRecords } from "../lib/vocabulary/ndjson-repository";
import type { VocabularyRecord } from "../lib/vocabulary/schema";
import {
  promoteRelationshipVerifiedContent,
  type RelationshipOnlyReason,
} from "../lib/vocabulary/verification/content-promotion";
import { VerificationReportSchema } from "../lib/vocabulary/verification/report";

type PromotionOptions = {
  root: string;
  reportsRoot: string;
  cacheRoot: string;
  write: boolean;
};

async function loadRecords(root: string): Promise<VocabularyRecord[]> {
  const records: VocabularyRecord[] = [];
  for await (const record of openNdjsonRepository(root).all()) records.push(record);
  return records;
}

async function loadRelationshipReasons(reportsRoot: string): Promise<Map<string, RelationshipOnlyReason>> {
  const reasons = new Map<string, RelationshipOnlyReason>();
  const names = (await readdir(reportsRoot)).filter((name) => /^batch-\d+-write\.json$/u.test(name)).sort();
  for (const name of names) {
    const report = VerificationReportSchema.parse(JSON.parse(await readFile(path.join(reportsRoot, name), "utf8")));
    for (const entry of report.entries) {
      if (entry.reason !== "relationship_ambiguous" && entry.reason !== "relationship_unsupported") continue;
      const existing = reasons.get(entry.lemma);
      if (existing && existing !== entry.reason) {
        throw new Error(`Conflicting relationship outcomes for ${entry.lemma}`);
      }
      reasons.set(entry.lemma, entry.reason);
    }
  }
  return reasons;
}

async function collectJsonFiles(root: string, files: string[] = []): Promise<string[]> {
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const entryPath = path.join(root, entry.name);
    if (entry.isDirectory()) await collectJsonFiles(entryPath, files);
    else if (entry.isFile() && entry.name.endsWith(".json") && path.basename(path.dirname(entryPath)) === "llm") {
      files.push(entryPath);
    }
  }
  return files;
}

async function loadCachedSelections(
  cacheRoot: string,
  records: readonly VocabularyRecord[],
): Promise<Map<string, Set<string>>> {
  const lemmaBySenseId = new Map(records.flatMap((record) =>
    record.senses.map((sense) => [sense.id, record.lemma] as const),
  ));
  const selections = new Map<string, Set<string>>();
  for (const filePath of await collectJsonFiles(cacheRoot)) {
    let value: unknown;
    try {
      value = JSON.parse(await readFile(filePath, "utf8"));
    } catch {
      continue;
    }
    const cached = typeof value === "object" && value !== null && "value" in value ? value.value : null;
    if (typeof cached !== "object" || cached === null || !("selectedSenseId" in cached)) continue;
    const selectedSenseId = cached.selectedSenseId;
    if (typeof selectedSenseId !== "string") continue;
    const lemma = lemmaBySenseId.get(selectedSenseId);
    if (!lemma) continue;
    const ids = selections.get(lemma) ?? new Set<string>();
    ids.add(selectedSenseId);
    selections.set(lemma, ids);
  }
  return selections;
}

export async function runContentPromotion(options: PromotionOptions) {
  const records = await loadRecords(options.root);
  const baseline = auditDictionaryRecords(records);
  const reasons = await loadRelationshipReasons(options.reportsRoot);
  const selections = await loadCachedSelections(options.cacheRoot, records);
  const result = promoteRelationshipVerifiedContent(records, reasons, selections);
  const proposed = auditDictionaryRecords(result.snapshot);
  const regressions = [
    ...strictViolationRegressions(proposed.total.strict, baseline.total.strict),
    ...strictViolationIdentityRegressions(proposed.strictViolations, baseline.strictViolations),
  ];
  if (regressions.length > 0) {
    throw new Error(`Content promotion introduced strict dictionary regressions: ${regressions.join(", ")}`);
  }
  const changedShards = options.write && result.updates.length > 0
    ? await writeVocabularyRecords(options.root, result.updates)
    : [];
  return {
    candidates: reasons.size,
    promoted: result.promoted.length,
    ambiguousRelationships: result.promoted.filter((entry) => entry.relationshipStatus === "ambiguous").length,
    unsupportedRelationships: result.promoted.filter((entry) => entry.relationshipStatus === "unsupported").length,
    unresolved: result.unresolved,
    updates: result.updates.length,
    changedShards,
  };
}

function argumentValue(args: readonly string[], name: string, fallback: string): string {
  const argument = args.find((value) => value.startsWith(`${name}=`));
  return argument ? argument.slice(name.length + 1) : fallback;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const root = path.resolve(argumentValue(args, "--root", path.join(process.cwd(), "content", "vocabulary")));
  const reportsRoot = path.resolve(argumentValue(
    args,
    "--reports",
    path.join(process.cwd(), ".cache", "vocabulary-verification", "all-25-v3"),
  ));
  const cacheRoot = path.resolve(argumentValue(args, "--cache", reportsRoot));
  const write = args.includes("--write");
  const result = await runContentPromotion({ root, reportsRoot, cacheRoot, write });
  console.log(`${write ? "Write" : "Dry run"}: ${result.promoted}/${result.candidates} relationship-only candidates promoted.`);
  console.log(`Relationships: ${result.ambiguousRelationships} ambiguous; ${result.unsupportedRelationships} unsupported.`);
  console.log(`Canonical updates: ${result.updates}; changed shards: ${result.changedShards.join(", ") || "none"}.`);
  if (result.unresolved.length > 0) {
    console.log(`Unresolved: ${result.unresolved.length} (${result.unresolved.slice(0, 20).map((entry) => entry.lemma).join(", ")}).`);
    process.exitCode = 2;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.join(process.cwd(), "scripts", "promote-verified-content.ts")) {
  void main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
