import path from "node:path";
import { VOCABULARY_SHARD_IDS, migrateVocabularyCorpus } from "../lib/vocabulary/migration-cli";

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

async function main(): Promise<void> {
  const arguments_ = parseArguments(process.argv.slice(2));
  const source = path.resolve(arguments_.source);
  const output = path.resolve(arguments_.out);
  const manifest = await migrateVocabularyCorpus({
    sourceDirectory: source,
    outputDirectory: output,
    force: arguments_.force,
    generatedFrom: arguments_.source,
  });
  console.log(`Migrated ${manifest.totals.records} records across ${VOCABULARY_SHARD_IDS.length} shards with ${manifest.totals.connections} connections.`);
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
