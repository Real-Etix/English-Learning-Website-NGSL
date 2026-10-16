/** Offline, explicit reviewed release. No provider clients, credentials or paid calls. */
import { readFile, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { openNdjsonRepository, writeVocabularyRecords } from "../lib/vocabulary/ndjson-repository";
import { applyLimitedRelease, LimitedReleaseManifestSchema, releaseRecordHash } from "../lib/vocabulary/limited-release";
import { acquireRecoveryLock } from "../lib/vocabulary/verification/recovery-io";
import { hasFactualExample } from "../lib/vocabulary/meaning-review";
import type { VocabularyRecord } from "../lib/vocabulary/schema";

async function main() {
  const args = process.argv.slice(2);
  if (args.length > 1 || args.some(arg => arg !== "--write")) throw new Error("Usage: release-limited-examples.ts [--write]");
  const write = args.includes("--write");
  const root = path.resolve(".cache/vocabulary-repair");
  await mkdir(root, { recursive: true });
  const unlock = await acquireRecoveryLock(root);
  try {
    const manifest = LimitedReleaseManifestSchema.parse(JSON.parse(await readFile("content/vocabulary/limited-example-release.json", "utf8")));
    const repo = openNdjsonRepository();
    const updates: VocabularyRecord[] = [];
    const before: VocabularyRecord[] = [];
    // Validate the entire manifest before the first canonical write.
    for (const [lemma, decision] of Object.entries(manifest.entries)) {
      if (lemma in manifest.withheld) throw new Error(`Conflicting decisions: ${lemma}`);
      const record = await repo.get(lemma);
      if (!record || record.lemma !== lemma) throw new Error(`Missing word: ${lemma}`);
      const next = applyLimitedRelease(record, decision);
      if (releaseRecordHash(next) !== releaseRecordHash(record)) { before.push(record); updates.push(next); }
    }
    const report = {
      mode: write ? "write" : "dry-run", reviewed: Object.keys(manifest.entries).length,
      changed: updates.length, meaningOnly: updates.filter(r => !hasFactualExample(r.senses.find(s => s.status === "published")!)).length,
      lemmas: updates.map(r => r.lemma), withheld: manifest.withheld,
    };
    if (write && updates.length) {
      const out = path.join(root, "limited-example-release-v1");
      await mkdir(out, { recursive: true });
      // Unique backup per apply; repeat runs never overwrite the pre-release records.
      const stamp = `${Date.now()}-${process.pid}`;
      await writeFile(path.join(out, `before-${stamp}.json`), JSON.stringify(before), { flag: "wx" });
      await writeVocabularyRecords(path.resolve("content/vocabulary"), updates);
      await writeFile(path.join(out, `report-${stamp}.json`), JSON.stringify(report, null, 2), { flag: "wx" });
    }
    console.log(JSON.stringify(report, null, 2));
  } finally { await unlock(); }
}
void main().catch(error => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; });
