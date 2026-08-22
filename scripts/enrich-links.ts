/** Add validated lateral links between vocabulary records that already exist. */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { applyVocabularyProposals, type VocabularyProposal } from "../lib/vocabulary/enrichment/apply-proposals";
import { buildListGraph } from "../lib/vocabulary/graph";
import { toGraphInput } from "../lib/vocabulary/graph-input";
import { openNdjsonRepository, writeVocabularyRecords } from "../lib/vocabulary/ndjson-repository";
import { normalizeVocabularyLemma } from "../lib/vocabulary/shards";
import type { VocabularyRecord } from "../lib/vocabulary/schema";
import { completeJSON, hasLLM, LLM_MODEL } from "./llm-client";

const RAW_DIR = path.join(process.cwd(), "wiki", "raw");
const UNRESOLVED = path.join(RAW_DIR, "unresolved.json");
const MAX_ADD = 5;

type SuggestedLink = { word?: string; gloss?: string };
type UnresolvedWord = { word: string; reason: string };

function parseArgs() {
  const arguments_ = process.argv.slice(2);
  const get = (name: string) => arguments_.find((argument) => argument.startsWith(`--${name}=`))?.slice(name.length + 3);
  return {
    list: get("list"),
    maxDegree: Number(get("max-degree")) || 3,
    limit: Number(get("limit")) || Number.POSITIVE_INFINITY,
    dryRun: arguments_.includes("--dry-run"),
  };
}

async function collectRecords(): Promise<VocabularyRecord[]> {
  const records: VocabularyRecord[] = [];
  for await (const record of openNdjsonRepository().all()) records.push(record);
  return records;
}

async function askLinks(record: VocabularyRecord): Promise<{ synonyms: SuggestedLink[]; collocations: SuggestedLink[] }> {
  const response = await completeJSON<{ synonyms?: SuggestedLink[]; collocations?: SuggestedLink[] }>(
    "You give lateral English vocabulary links. Only propose common existing words and include concise learner guidance. Reply JSON only.",
    JSON.stringify({
      word: record.display,
      partOfSpeech: record.partOfSpeech,
      definition: record.senses[0]?.definition ?? "",
      format: {
        synonyms: [{ word: "string", gloss: "non-empty learner guidance" }],
        collocations: [{ word: "string", gloss: "non-empty learner guidance" }],
      },
    }),
    LLM_MODEL,
    2,
  );
  return { synonyms: response?.synonyms ?? [], collocations: response?.collocations ?? [] };
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
    // The report is recreated when it is absent or cannot be parsed.
  }
  const unique = new Map<string, UnresolvedWord>();
  for (const entry of [...existing, ...entries]) unique.set(`${entry.word}\u0000${entry.reason}`, entry);
  await writeFile(UNRESOLVED, `${JSON.stringify([...unique.values()], null, 2)}\n`, "utf8");
}

async function main() {
  const args = parseArgs();
  const records = await collectRecords();
  const graphInputs = records.map((record) => toGraphInput(record, { records }));
  const degree = new Map<string, number>();
  if (args.list) {
    for (const node of buildListGraph(graphInputs, args.list).nodes) degree.set(node.lemma, node.degree);
  } else {
    for (const record of graphInputs) for (const connection of record.connections) {
      degree.set(record.lemma, (degree.get(record.lemma) ?? 0) + 1);
      degree.set(connection.target, (degree.get(connection.target) ?? 0) + 1);
    }
  }
  const candidates = records
    .filter((record) => (!args.list || record.lists.some((membership) => membership.id === args.list)) && (degree.get(record.lemma) ?? 0) < args.maxDegree)
    .slice(0, args.limit);
  console.log(`Selected lemmas (${candidates.length}): ${candidates.map((record) => record.lemma).join(", ") || "none"}`);
  if (!hasLLM()) {
    console.log("Enrichment unavailable: no LLM configured (set LLM_API_KEY).");
    console.log("Proposed 0 connection(s); rejected 0; changed 0 record(s).");
    return;
  }

  const suggestions = await Promise.all(candidates.map(async (record) => ({ record, links: await askLinks(record) })));
  const proposals: VocabularyProposal[] = [];
  for (const { record, links } of suggestions) {
    let added = 0;
    for (const [type, linksForType] of [["synonym", links.synonyms], ["collocation", links.collocations]] as const) {
      for (const link of linksForType) {
        if (added >= MAX_ADD) break;
        const target = normalizeVocabularyLemma(link.word ?? "");
        const gloss = link.gloss?.trim() ?? "";
        if (!target || target === record.lemma) continue;
        proposals.push({ kind: "connection", lemma: record.lemma, target, type, gloss, sourceId: "llm" });
        proposals.push({ kind: "connection", lemma: target, target: record.lemma, type, gloss, sourceId: "llm" });
        added += 1;
      }
    }
  }
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
