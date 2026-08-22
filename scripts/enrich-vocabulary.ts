import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { applyVocabularyProposals, type VocabularyProposal } from "../lib/vocabulary/enrichment/apply-proposals";
import { openNdjsonRepository, writeVocabularyRecords } from "../lib/vocabulary/ndjson-repository";
import { normalizeVocabularyLemma } from "../lib/vocabulary/shards";
import type { VocabularyRecord } from "../lib/vocabulary/schema";
import { completeJSON, hasLLM, LLM_MODEL } from "./llm-client";

const RAW_DIR = path.join(process.cwd(), "wiki", "raw");
const UNRESOLVED = path.join(RAW_DIR, "unresolved.json");

type Args = { list: string; limit: number; dryRun: boolean };
type SuggestedForm = { word?: string; gloss?: string };
type UnresolvedWord = { word: string; reason: string };

function parseArgs(): Args {
  const arguments_ = process.argv.slice(2);
  const get = (name: string) => arguments_.find((argument) => argument.startsWith(`--${name}=`))?.slice(name.length + 3);
  return {
    list: get("list") ?? "ngsl",
    limit: Number(get("limit")) || 10,
    dryRun: arguments_.includes("--dry-run"),
  };
}

function listRank(record: VocabularyRecord, list: string): number {
  return record.lists.find((membership) => membership.id === list)?.rank ?? Number.MAX_SAFE_INTEGER;
}

async function collectRecords(): Promise<VocabularyRecord[]> {
  const records: VocabularyRecord[] = [];
  for await (const record of openNdjsonRepository().all()) records.push(record);
  return records;
}

async function requestForms(record: VocabularyRecord): Promise<SuggestedForm[]> {
  const definition = record.senses[0]?.definition;
  if (!definition) return [];
  const response = await completeJSON<{ advanced_forms?: SuggestedForm[] }>(
    "You propose concise, learner-safe advanced vocabulary links. Return strict JSON only. " +
      "Each proposal must be a standard single English word and explain when to use it.",
    JSON.stringify({
      word: record.display,
      partOfSpeech: record.partOfSpeech,
      definition,
      format: { advanced_forms: [{ word: "string", gloss: "non-empty learner guidance" }] },
    }),
    LLM_MODEL,
    2,
  );
  return response?.advanced_forms ?? [];
}

async function reportUnresolved(entries: UnresolvedWord[]): Promise<void> {
  if (entries.length === 0) return;
  await mkdir(RAW_DIR, { recursive: true });
  let existing: UnresolvedWord[] = [];
  try {
    const parsed = JSON.parse(await readFile(UNRESOLVED, "utf8")) as unknown;
    if (Array.isArray(parsed)) {
      existing = parsed.filter((entry): entry is UnresolvedWord =>
        typeof entry === "object" && entry !== null &&
        typeof (entry as UnresolvedWord).word === "string" &&
        typeof (entry as UnresolvedWord).reason === "string",
      );
    }
  } catch {
    // A missing or legacy malformed report is replaced with validated entries.
  }
  const unique = new Map<string, UnresolvedWord>();
  for (const entry of [...existing, ...entries]) unique.set(`${entry.word}\u0000${entry.reason}`, entry);
  await writeFile(UNRESOLVED, `${JSON.stringify([...unique.values()], null, 2)}\n`, "utf8");
}

async function main() {
  const args = parseArgs();
  const records = await collectRecords();
  const selected = records
    .filter((record) => record.tier === "core" && record.lists.some((membership) => membership.id === args.list))
    .sort((left, right) => listRank(left, args.list) - listRank(right, args.list) || (left.lemma < right.lemma ? -1 : 1))
    .slice(0, args.limit);

  console.log(`Selected lemmas (${selected.length}): ${selected.map((record) => record.lemma).join(", ") || "none"}`);
  if (!hasLLM()) {
    console.log("Enrichment unavailable: no LLM configured (set LLM_API_KEY).");
    console.log("Proposed 0 connection(s); rejected 0; changed 0 record(s).");
    return;
  }

  const forms = await Promise.all(selected.map(async (record) => ({ record, forms: await requestForms(record) })));
  const proposals: VocabularyProposal[] = forms.flatMap(({ record, forms: suggested }) => suggested.flatMap((form) => {
    const target = normalizeVocabularyLemma(form.word ?? "");
    const gloss = form.gloss?.trim() ?? "";
    if (!target) return [];
    return [{ kind: "connection", lemma: record.lemma, target, type: "advanced_form", gloss, sourceId: "llm" }];
  }));
  const result = applyVocabularyProposals(records, proposals);
  const unresolved = result.rejected.flatMap((rejection) => {
    const match = /^unknown target: (.+)$/.exec(rejection.reason);
    return match ? [{ word: match[1], reason: `enrichment suggestion from ${rejection.lemma}` }] : [];
  });

  if (!args.dryRun) {
    const shards = await writeVocabularyRecords(path.join(process.cwd(), "content", "vocabulary"), result.changed);
    await reportUnresolved(unresolved);
    console.log(`Updated shard(s): ${shards.join(", ") || "none"}`);
  }
  console.log(`Proposed ${proposals.length} connection(s); rejected ${result.rejected.length}; changed ${result.changed.length} record(s).`);
  for (const rejection of result.rejected) console.log(`  rejected ${rejection.lemma}: ${rejection.reason}`);
  if (args.dryRun) console.log("Dry run: no canonical shards or raw reports were written.");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
