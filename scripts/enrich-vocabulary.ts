import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { applyVocabularyProposals, type VocabularyProposal } from "../lib/vocabulary/enrichment/apply-proposals";
import { TokenBudget, type TokenUsage } from "../lib/vocabulary/enrichment/budget";
import {
  ENRICHMENT_STAGES,
  selectEnrichmentBatchDetails,
  type EnrichmentStage,
} from "../lib/vocabulary/enrichment/select-batch";
import { openNdjsonRepository, writeVocabularyRecords } from "../lib/vocabulary/ndjson-repository";
import { normalizeVocabularyLemma } from "../lib/vocabulary/shards";
import type { VocabularyRecord } from "../lib/vocabulary/schema";
import { completeJSONResult, hasLLM, LLM_MODEL } from "./llm-client";

const RAW_DIR = path.join(process.cwd(), "wiki", "raw");
const UNRESOLVED = path.join(RAW_DIR, "unresolved.json");

const DEFAULT_MAX_INPUT_TOKENS = 10_000;
const DEFAULT_MAX_OUTPUT_TOKENS = 5_000;
const MAX_OUTPUT_TOKENS_PER_REQUEST = 300;

type Args = {
  stage: EnrichmentStage;
  limit: number;
  maxInputTokens: number;
  maxOutputTokens: number;
  dryRun: boolean;
};
type SuggestedForm = { word?: string; gloss?: string };
type UnresolvedWord = { word: string; reason: string };

function readNumber(name: string, value: string | undefined, fallback: number): number {
  if (value === undefined) return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) throw new Error(`--${name} must be a non-negative integer`);
  return parsed;
}

function parseArgs(): Args {
  const arguments_ = process.argv.slice(2);
  const get = (name: string) => arguments_.find((argument) => argument.startsWith(`--${name}=`))?.slice(name.length + 3);
  const requestedStage = get("stage") ?? get("list") ?? "ngsl";
  if (requestedStage !== "all" && !ENRICHMENT_STAGES.includes(requestedStage as (typeof ENRICHMENT_STAGES)[number])) {
    throw new Error(`--stage must be one of all, ${ENRICHMENT_STAGES.join(", ")}`);
  }
  return {
    stage: requestedStage as EnrichmentStage,
    limit: readNumber("limit", get("limit"), 10),
    maxInputTokens: readNumber("max-input-tokens", get("max-input-tokens"), DEFAULT_MAX_INPUT_TOKENS),
    maxOutputTokens: readNumber("max-output-tokens", get("max-output-tokens"), DEFAULT_MAX_OUTPUT_TOKENS),
    dryRun: arguments_.includes("--dry-run"),
  };
}

function formRequest(record: VocabularyRecord): { system: string; user: string } | null {
  const definition = record.senses[0]?.definition;
  if (!definition) return null;
  return {
    system: "You propose concise, learner-safe advanced vocabulary links. Return strict JSON only. Each proposal must be a standard single English word and explain when to use it.",
    user: JSON.stringify({
      word: record.display,
      partOfSpeech: record.partOfSpeech,
      definition,
      format: { advanced_forms: [{ word: "string", gloss: "non-empty learner guidance" }] },
    }),
  };
}

function estimateTokenUsage(record: VocabularyRecord): TokenUsage {
  const request = formRequest(record);
  if (!request) return { inputTokens: 0, outputTokens: 0 };
  // UTF-8 byte length is a conservative deterministic local upper estimate for
  // a tokenizer's prompt payload; the fixed margin covers chat framing.
  return {
    inputTokens: Buffer.byteLength(`${request.system}\n${request.user}`, "utf8") + 32,
    outputTokens: MAX_OUTPUT_TOKENS_PER_REQUEST,
  };
}

async function collectRecords(): Promise<VocabularyRecord[]> {
  const records: VocabularyRecord[] = [];
  for await (const record of openNdjsonRepository().all()) records.push(record);
  return records;
}

async function requestForms(record: VocabularyRecord, requestId: string, reserved: TokenUsage) {
  const request = formRequest(record);
  if (!request) return null;
  return completeJSONResult<{ advanced_forms?: SuggestedForm[] }>(
    request.system,
    request.user,
    LLM_MODEL,
    2,
    { requestId, fallbackUsage: reserved, maxOutputTokens: reserved.outputTokens },
  );
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
  const selected = selectEnrichmentBatchDetails(records, { stage: args.stage, limit: args.limit });
  const estimated = selected.map(({ record }) => estimateTokenUsage(record));
  const estimatedTotals = estimated.reduce<TokenUsage>(
    (total, usage) => ({ inputTokens: total.inputTokens + usage.inputTokens, outputTokens: total.outputTokens + usage.outputTokens }),
    { inputTokens: 0, outputTokens: 0 },
  );

  console.log(`Selected ${args.stage} enrichment batch (${selected.length}):`);
  for (const [index, selection] of selected.entries()) {
    const usage = estimated[index]!;
    console.log(`  ${selection.record.lemma}: ${selection.reason}; estimated input ${usage.inputTokens}, output ${usage.outputTokens} tokens`);
  }
  console.log(`Estimated tokens: input ${estimatedTotals.inputTokens}, output ${estimatedTotals.outputTokens}.`);
  if (args.dryRun) {
    console.log("Dry run: no LLM API calls, canonical shards, or raw reports were written.");
    return;
  }
  if (!hasLLM()) {
    console.log("Enrichment unavailable: no LLM configured (set LLM_API_KEY).");
    console.log("Proposed 0 connection(s); rejected 0; changed 0 record(s).");
    return;
  }

  const budget = new TokenBudget({ maxInputTokens: args.maxInputTokens, maxOutputTokens: args.maxOutputTokens });
  const forms: Array<{ record: VocabularyRecord; forms: SuggestedForm[] }> = [];
  let budgetExhausted = false;
  for (const [index, selection] of selected.entries()) {
    const record = selection.record;
    const reservation = estimated[index]!;
    const requestId = `vocabulary-enrichment:${normalizeVocabularyLemma(record.lemma)}`;
    if (!budget.reserve(requestId, reservation)) {
      budgetExhausted = true;
      break;
    }
    const response = await requestForms(record, requestId, reservation);
    // The client substitutes the reservation when a provider does not report
    // usage, so an absent usage block is never treated as free work.
    budget.recordActual(requestId, response?.usage ?? reservation);
    forms.push({ record, forms: response?.value.advanced_forms ?? [] });
  }

  if (budgetExhausted) {
    const remaining = budget.remaining();
    console.log(`Budget exhausted: stopped before the next request; remaining input ${remaining.inputTokens}, output ${remaining.outputTokens} tokens.`);
  }

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
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
