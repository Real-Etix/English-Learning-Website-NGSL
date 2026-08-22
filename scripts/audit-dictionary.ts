import {
  auditDictionaryPages,
  hasStrictFailures,
  type DictionaryQualityCounts,
} from "../lib/wiki/dictionary-quality";
import { readAllPages } from "../lib/wiki/parse-wiki";

const percentage = (count: number, total: number) =>
  total === 0 ? "0.0%" : `${((count / total) * 100).toFixed(1)}%`;

function pageMetric(label: string, count: number, total: number): string {
  return `${label}: ${count} (${percentage(count, total)})`;
}

function edgeMetric(label: string, count: number, total: number): string {
  return `${label}: ${count} (${percentage(count, total)} of edges)`;
}

function printSummary(label: string, counts: DictionaryQualityCounts) {
  console.log(`\n${label}`);
  console.log(`  Pages: ${counts.pages}`);
  console.log(`  ${pageMetric("Placeholder definitions", counts.placeholders, counts.pages)}`);
  console.log(`  ${pageMetric("No examples", counts.noExamples, counts.pages)}`);
  console.log(`  ${pageMetric("Unknown part of speech", counts.unknownPartOfSpeech, counts.pages)}`);
  console.log(`  ${pageMetric("LLM-only advanced", counts.llmOnlyAdvanced, counts.pages)}`);
  console.log(`  ${pageMetric("Zero connections", counts.zeroConnections, counts.pages)}`);
  console.log(`  Evidence: verified ${counts.evidence.verified} (${percentage(counts.evidence.verified, counts.pages)}), source-backed ${counts.evidence.sourceBacked} (${percentage(counts.evidence.sourceBacked, counts.pages)}), AI draft ${counts.evidence.aiDraft} (${percentage(counts.evidence.aiDraft, counts.pages)})`);
  console.log(`  Edges: ${counts.edges.total}`);
  console.log(`  ${edgeMetric("Unexplained edges", counts.edges.unexplained, counts.edges.total)}`);
  for (const type of Object.keys(counts.edges.byType).sort()) {
    const edge = counts.edges.byType[type];
    console.log(`    ${type}: ${edge.total} total, ${edge.unexplained} unexplained (${percentage(edge.unexplained, edge.total)})`);
  }
}

async function main() {
  const pages = await readAllPages();
  const report = auditDictionaryPages(pages);

  console.log("Dictionary quality audit");
  printSummary("Global totals", report.total);
  console.log("\nPer-list summaries");
  for (const list of Object.keys(report.lists).sort()) {
    printSummary(list, report.lists[list]);
  }

  if (process.argv.includes("--strict") && hasStrictFailures(report)) {
    console.error("\nStrict audit failed: placeholder definitions or LLM-only advanced pages remain.");
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
