import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { parseLegacyMarkdownPage, type WikiPage } from "../lib/vocabulary/legacy-markdown";
import { assertMigrationParity, compareLegacyAndCanonical } from "../lib/vocabulary/parity";
import { openNdjsonRepository } from "../lib/vocabulary/ndjson-repository";
import type { VocabularyRecord } from "../lib/vocabulary/schema";

async function readLegacyPages(directory: string): Promise<WikiPage[]> {
  const files = (await readdir(directory)).filter((file) => file.endsWith(".md")).sort();
  const pages: WikiPage[] = [];
  for (const file of files) {
    const page = parseLegacyMarkdownPage(await readFile(path.join(directory, file), "utf8"));
    if (!page) throw new Error(`Cannot parse legacy Markdown page: ${path.join(directory, file)}`);
    pages.push(page);
  }
  return pages;
}

async function readCanonicalRecords(directory: string): Promise<VocabularyRecord[]> {
  const records: VocabularyRecord[] = [];
  for await (const record of openNdjsonRepository(directory).all()) records.push(record);
  return records;
}

async function main(): Promise<void> {
  const root = process.cwd();
  const [legacy, canonical] = await Promise.all([
    readLegacyPages(path.join(root, "wiki", "pages")),
    readCanonicalRecords(path.join(root, "content", "vocabulary")),
  ]);
  const report = compareLegacyAndCanonical(legacy, canonical);
  const reportPath = path.join(root, "data", "generated", "vocabulary-migration-report.json");
  await mkdir(path.dirname(reportPath), { recursive: true });
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  console.log(`Vocabulary migration parity: ${report.ok ? "ok" : "failed"} · ${legacy.length} legacy · ${canonical.length} canonical`);
  console.log(`Report: ${path.relative(root, reportPath)}`);
  assertMigrationParity(report);
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
