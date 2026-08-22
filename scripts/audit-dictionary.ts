import { readFile } from "node:fs/promises";

import {
  auditDictionaryRecords,
  hasStrictFailures,
  strictViolationRegressions,
  type DictionaryQualityCounts,
  type DictionaryStrictViolationCounts,
} from "../lib/wiki/dictionary-quality";
import { openNdjsonRepository } from "../lib/vocabulary/ndjson-repository";

const percentage = (count: number, total: number) =>
  total === 0 ? "0.0%" : `${((count / total) * 100).toFixed(1)}%`;

function pageMetric(label: string, count: number, total: number): string {
  return `${label}: ${count} (${percentage(count, total)})`;
}

function edgeMetric(label: string, count: number, total: number): string {
  return `${label}: ${count} (${percentage(count, total)} of edges)`;
}

const strictLabels: Record<keyof DictionaryStrictViolationCounts, string> = {
  publishedPlaceholders: "published placeholders",
  publishedUnsupportedSenses: "published unsupported senses",
  claimableSensesWithoutSourcedExamples: "claimable senses without sourced examples",
  publishedConnectionsToHiddenOrMissingTargets: "published connections to hidden or missing targets",
  learnerConnectionsWithoutGloss: "learner-facing connections without glosses",
};

function strictSummary(strict: DictionaryStrictViolationCounts): string {
  return Object.entries(strict)
    .map(([key, count]) => `${strictLabels[key as keyof DictionaryStrictViolationCounts]} ${count}`)
    .join(", ");
}

function isStrictViolationCounts(value: unknown): value is DictionaryStrictViolationCounts {
  return typeof value === "object" && value !== null
    && Object.keys(strictLabels).every((key) => {
      const count = value[key as keyof typeof value];
      return typeof count === "number" && Number.isFinite(count) && count >= 0;
    });
}

function strictCountsFromManifest(value: unknown): DictionaryStrictViolationCounts {
  const strict = typeof value === "object" && value !== null
    && "total" in value
    && typeof value.total === "object"
    && value.total !== null
    && "strict" in value.total
    ? value.total.strict
    : null;
  if (!isStrictViolationCounts(strict)) {
    throw new Error("Base audit manifest contains invalid strict violation counts.");
  }
  return strict;
}

function printSummary(label: string, counts: DictionaryQualityCounts) {
  console.log(`\n${label}`);
  console.log(`  Pages: ${counts.pages}`);
  console.log(`  ${pageMetric("Placeholder definitions", counts.placeholders, counts.pages)}`);
  console.log(`  ${pageMetric("No examples", counts.noExamples, counts.pages)}`);
  console.log(`  ${pageMetric("Unknown part of speech", counts.unknownPartOfSpeech, counts.pages)}`);
  console.log(`  ${pageMetric("LLM-only advanced", counts.llmOnlyAdvanced, counts.pages)}`);
  console.log(`  ${pageMetric("Zero connections", counts.zeroConnections, counts.pages)}`);
  console.log(`  Publication: draft ${counts.publication.draft}, review ${counts.publication.review}, published ${counts.publication.published}, hidden ${counts.publication.hidden}`);
  console.log(`  Senses: ${counts.senses.total} total, ${counts.senses.unsupported} unsupported, ${counts.senses.withoutExamples} without examples`);
  console.log(`  Usage: ${counts.usage.withoutPatterns} without patterns, ${counts.usage.withoutMistakes} without mistakes`);
  console.log(`  Connections: ${counts.connections.published} published, ${counts.connections.unreviewed} unreviewed, ${counts.connections.hidden} hidden, ${counts.connections.unexplained} unexplained`);
  console.log(`  Advanced: ${counts.advanced.quarantined} quarantined, ${counts.advanced.reviewable} reviewable, ${counts.advanced.published} published`);
  console.log(`  Claimable senses: ${counts.claimableSenses}`);
  console.log(`  Sources: curated ${counts.sources.curated}, wordnet ${counts.sources.wordnet}, dictionaryapi ${counts.sources.dictionaryapi}, tatoeba ${counts.sources.tatoeba}, llm ${counts.sources.llm}`);
  console.log(`  Strict blocking: ${strictSummary(counts.strict)}`);
  console.log(`  Evidence: verified ${counts.evidence.verified} (${percentage(counts.evidence.verified, counts.pages)}), source-backed ${counts.evidence.sourceBacked} (${percentage(counts.evidence.sourceBacked, counts.pages)}), AI draft ${counts.evidence.aiDraft} (${percentage(counts.evidence.aiDraft, counts.pages)})`);
  console.log(`  Edges: ${counts.edges.total}`);
  console.log(`  Published edges: ${counts.edges.published}`);
  console.log(`  Unreviewed edges: ${counts.edges.unreviewed}`);
  console.log(`  Hidden edges: ${counts.edges.hidden}`);
  console.log(`  ${edgeMetric("Explained edges", counts.edges.explained, counts.edges.total)}`);
  console.log(`  Explained published edges: ${counts.edges.explainedByStatus.published}`);
  console.log(`  Explained unreviewed edges: ${counts.edges.explainedByStatus.unreviewed}`);
  console.log(`  Explained hidden edges: ${counts.edges.explainedByStatus.hidden}`);
  console.log(`  ${edgeMetric("Unexplained edges", counts.edges.unexplained, counts.edges.total)}`);
  for (const type of Object.keys(counts.edges.byType).sort()) {
    const edge = counts.edges.byType[type];
    console.log(`    ${type}: ${edge.total} total, ${edge.published} published, ${edge.unreviewed} unreviewed, ${edge.hidden} hidden, ${edge.explained} explained (${edge.explainedByStatus.published} published / ${edge.explainedByStatus.unreviewed} unreviewed / ${edge.explainedByStatus.hidden} hidden), ${edge.unexplained} unexplained (${percentage(edge.unexplained, edge.total)})`);
  }
}

async function main() {
  const args = process.argv.slice(2);
  const strict = args.includes("--strict");
  const json = args.includes("--json");
  const baseManifestArgument = args.find((argument) => argument.startsWith("--base-manifest="));
  const baseManifestPath = baseManifestArgument?.slice("--base-manifest=".length);
  if (baseManifestArgument && !baseManifestPath) throw new Error("--base-manifest requires a file path.");
  if (baseManifestPath && !strict) throw new Error("--base-manifest requires --strict.");

  const records = [];
  for await (const record of openNdjsonRepository().all()) records.push(record);
  const report = auditDictionaryRecords(records);

  if (json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log("Dictionary quality audit");
    printSummary("Global totals", report.total);
    console.log("\nPer-list summaries");
    for (const list of Object.keys(report.lists).sort()) {
      printSummary(list, report.lists[list]);
    }
  }

  if (!strict) return;

  if (baseManifestPath) {
    const base = strictCountsFromManifest(JSON.parse(await readFile(baseManifestPath, "utf8")));
    const regressions = strictViolationRegressions(report.total.strict, base);
    if (regressions.length > 0) {
      console.error(`\nStrict audit regression against base manifest: ${regressions.join("; ")}.`);
      process.exitCode = 1;
    } else if (!json) {
      console.log("\nStrict audit base-manifest comparison found no increased blocking categories.");
    }
    return;
  }

  if (hasStrictFailures(report)) {
    console.error(`\nStrict audit failed: ${strictSummary(report.total.strict)}.`);
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
