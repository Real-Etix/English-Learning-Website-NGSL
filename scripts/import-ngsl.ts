import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { listCatalog } from "../lib/ngsl/list-catalog";
import {
  mergeFormsIntoWords,
  parseStatsCsv,
  parseTeachingForms,
} from "../lib/ngsl/parse-wordlists";
import type { ImportedCatalog, ImportedListData, LearningListSlug } from "../lib/types";

async function fetchText(url: string) {
  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(`Failed to fetch ${url}: ${response.status}`);
  }

  return response.text();
}

async function importList(slug: LearningListSlug): Promise<ImportedListData> {
  const entry = listCatalog[slug];
  const [statsRaw, formsRaw] = await Promise.all([
    fetchText(entry.statsUrl),
    fetchText(entry.rawFormsUrl),
  ]);

  const words = mergeFormsIntoWords(
    parseStatsCsv(statsRaw, slug),
    parseTeachingForms(formsRaw),
  );

  return {
    ...entry,
    wordCount: words.length,
    words,
  };
}

async function main() {
  const projectRoot = process.cwd();
  const outputDirectory = path.join(projectRoot, "data", "generated");
  const outputPath = path.join(outputDirectory, "word-lists.json");

  const lists = await Promise.all(
    Object.keys(listCatalog).map((slug) => importList(slug as LearningListSlug)),
  );

  const payload: ImportedCatalog = {
    generatedAt: new Date().toISOString(),
    lists,
  };

  await mkdir(outputDirectory, { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");

  console.log(
    `Imported ${lists.length} lists and ${lists.reduce(
      (total, list) => total + list.wordCount,
      0,
    )} words into ${outputPath}`,
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
