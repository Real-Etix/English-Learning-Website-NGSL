import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { fetchWordDetail, type WordDetail } from "../lib/content/word-detail";
import { enrichRecord, type FactualEnrichmentDetail } from "../lib/vocabulary/enrichment/enrich-record";
import { TokenBudget, type TokenUsage } from "../lib/vocabulary/enrichment/budget";
import { ENRICHMENT_STAGES, selectEnrichmentBatchDetails, type EnrichmentStage } from "../lib/vocabulary/enrichment/select-batch";
import type { DictionaryImportSource } from "../lib/vocabulary/enrichment/dictionary-import";
import { openNdjsonRepository, writeVocabularyRecords } from "../lib/vocabulary/ndjson-repository";
import { normalizeVocabularyLemma } from "../lib/vocabulary/shards";
import type { VocabularyRecord } from "../lib/vocabulary/schema";
import { completeJSONResult, hasLLM, LLM_MODEL } from "./llm-client";

const DEFAULT_MAX_INPUT_TOKENS = 10_000;
const DEFAULT_MAX_OUTPUT_TOKENS = 5_000;
const MAX_OUTPUT_TOKENS_PER_REQUEST = 300;

type Args = { stage: EnrichmentStage; limit: number; maxInputTokens: number; maxOutputTokens: number; dryRun: boolean; fixturePath: string | null; reportPath: string | null };
type SourceBackedFixture = { source?: DictionaryImportSource; dictionary?: Record<string, WordDetail>; proposals?: Record<string, { proposal?: unknown; usage?: TokenUsage }> };
type EnrichmentReport = { stage: string; factualImports: number; reviewProposals: number; hiddenRecords: number; rejections: number; unknownTargets: number; tokenUsage: TokenUsage; estimatedRemainingDebt: number };

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
  if (requestedStage !== "all" && !ENRICHMENT_STAGES.includes(requestedStage as (typeof ENRICHMENT_STAGES)[number])) throw new Error(`--stage must be one of all, ${ENRICHMENT_STAGES.join(", ")}`);
  return {
    stage: requestedStage as EnrichmentStage,
    limit: readNumber("limit", get("limit"), 10),
    maxInputTokens: readNumber("max-input-tokens", get("max-input-tokens"), DEFAULT_MAX_INPUT_TOKENS),
    maxOutputTokens: readNumber("max-output-tokens", get("max-output-tokens"), DEFAULT_MAX_OUTPUT_TOKENS),
    dryRun: arguments_.includes("--dry-run"), fixturePath: get("fixture") ?? null, reportPath: get("report") ?? null,
  };
}

function formRequest(record: VocabularyRecord, publicTargets: readonly string[]): { system: string; user: string } | null {
  const factualSenses = record.senses.filter((sense) => sense.sources.some((source) => source.sourceId !== "llm"));
  if (factualSenses.length === 0) return null;
  return {
    system: "Return only JSON matching the requested guidance schema. Propose learner guidance only; do not provide definitions, source IDs, publication state, approval data, or new words.",
    user: JSON.stringify({
      record: { lemma: record.lemma, display: record.display, tier: record.tier, partOfSpeech: record.partOfSpeech },
      factualContent: factualSenses.map((sense) => ({ id: sense.id, partOfSpeech: sense.partOfSpeech, definition: sense.definition, examples: sense.examples.map((example) => example.text) })),
      publicConnectionTargets: publicTargets,
      guidanceSchema: {
        connections: [{ target: "existing public lemma", type: "builds_on", gloss: "non-empty learner guidance" }],
        usagePatterns: [{ senseId: "factual sense ID", pattern: "learner pattern", explanation: "non-empty explanation" }],
      },
    }),
  };
}

function estimateTokenUsage(record: VocabularyRecord, publicTargets: readonly string[]): TokenUsage {
  const request = formRequest(record, publicTargets);
  return request ? { inputTokens: Buffer.byteLength(`${request.system}\n${request.user}`, "utf8") + 32, outputTokens: MAX_OUTPUT_TOKENS_PER_REQUEST } : { inputTokens: 0, outputTokens: 0 };
}

async function collectRecords(): Promise<VocabularyRecord[]> {
  const records: VocabularyRecord[] = [];
  for await (const record of openNdjsonRepository().all()) records.push(record);
  return records;
}

async function loadFixture(fixturePath: string | null): Promise<SourceBackedFixture | null> {
  if (!fixturePath) return null;
  const parsed = JSON.parse(await readFile(path.resolve(fixturePath), "utf8")) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("--fixture must contain a JSON object");
  return parsed as SourceBackedFixture;
}

function dictionarySource(detail: WordDetail, fixture: SourceBackedFixture | null): DictionaryImportSource {
  return fixture?.source ?? { sourceId: "dictionaryapi", url: detail.sourceUrl ?? null, retrievedAt: new Date().toISOString(), contentHash: null };
}

async function factualDetailFor(record: VocabularyRecord, fixture: SourceBackedFixture | null): Promise<WordDetail> {
  if (fixture) return fixture.dictionary?.[record.lemma] ?? fixture.dictionary?.default ?? { ipa: null, audioUk: null, audioUs: null, audioAny: null, senses: [], synonyms: [] };
  return fetchWordDetail(record.display);
}

async function requestGuidance(record: VocabularyRecord, publicTargets: readonly string[], fixture: SourceBackedFixture | null, requestId: string, reserved: TokenUsage) {
  if (fixture) {
    const response = fixture.proposals?.[record.lemma] ?? fixture.proposals?.default;
    return response ? { value: response.proposal ?? {}, usage: response.usage ?? reserved } : { value: {}, usage: reserved };
  }
  const request = formRequest(record, publicTargets);
  if (!request) return { value: {}, usage: { inputTokens: 0, outputTokens: 0 } };
  const response = await completeJSONResult<unknown>(request.system, request.user, LLM_MODEL, 2, { requestId, fallbackUsage: reserved, maxOutputTokens: reserved.outputTokens });
  return response ?? { value: {}, usage: reserved };
}

async function writeReport(reportPath: string | null, report: EnrichmentReport): Promise<void> {
  if (!reportPath) return;
  const output = path.resolve(reportPath);
  await mkdir(path.dirname(output), { recursive: true });
  await writeFile(output, `${JSON.stringify(report, null, 2)}\n`, "utf8");
}

function publicTargetSets(records: VocabularyRecord[]) {
  const publicRecords = records.filter((record) => record.publicationStatus === "published");
  return { publicTargets: publicRecords.map((record) => record.lemma).sort(), publicCoreTargets: publicRecords.filter((record) => record.tier === "core").map((record) => record.lemma).sort() };
}

async function main() {
  const args = parseArgs();
  const fixture = await loadFixture(args.fixturePath);
  const records = await collectRecords();
  const selected = selectEnrichmentBatchDetails(records, { stage: args.stage, limit: args.limit });
  const { publicTargets, publicCoreTargets } = publicTargetSets(records);
  console.log(`Selected ${args.stage} enrichment batch (${selected.length}):`);
  for (const selection of selected) console.log(`  ${selection.record.lemma}: ${selection.reason}`);

  if (args.dryRun && !fixture) {
    const totals = selected.map(({ record }) => estimateTokenUsage(record, publicTargets)).reduce<TokenUsage>((total, usage) => ({ inputTokens: total.inputTokens + usage.inputTokens, outputTokens: total.outputTokens + usage.outputTokens }), { inputTokens: 0, outputTokens: 0 });
    console.log(`Estimated tokens: input ${totals.inputTokens}, output ${totals.outputTokens}.`);
    await writeReport(args.reportPath, { stage: args.stage, factualImports: 0, reviewProposals: 0, hiddenRecords: 0, rejections: 0, unknownTargets: 0, tokenUsage: { inputTokens: 0, outputTokens: 0 }, estimatedRemainingDebt: selected.length });
    console.log("Dry run: no dictionary or LLM API calls, canonical shards, or raw reports were written.");
    return;
  }
  if (!fixture && !hasLLM()) {
    await writeReport(args.reportPath, { stage: args.stage, factualImports: 0, reviewProposals: 0, hiddenRecords: 0, rejections: 0, unknownTargets: 0, tokenUsage: { inputTokens: 0, outputTokens: 0 }, estimatedRemainingDebt: selected.length });
    console.log("Enrichment unavailable: no LLM configured (set LLM_API_KEY).\nProposed 0 review item(s); rejected 0; changed 0 record(s).");
    return;
  }

  const budget = new TokenBudget({ maxInputTokens: args.maxInputTokens, maxOutputTokens: args.maxOutputTokens });
  const changed = new Map<string, VocabularyRecord>();
  let factualImports = 0; let reviewProposals = 0; let rejections = 0; let unknownTargets = 0; let hiddenRecords = 0; let budgetExhausted = false;
  let fixtureTokenUsage: TokenUsage = { inputTokens: 0, outputTokens: 0 };
  for (const selection of selected) {
    const detail = await factualDetailFor(selection.record, fixture);
    const facts: FactualEnrichmentDetail = { detail, source: dictionarySource(detail, fixture), knownPublicTargets: publicTargets, knownPublicCoreTargets: publicCoreTargets };
    const factualFirst = enrichRecord(selection.record, facts, {});
    const reserved = estimateTokenUsage(factualFirst.record, publicTargets);
    const requestId = `vocabulary-enrichment:${normalizeVocabularyLemma(selection.record.lemma)}`;
    if (!budget.reserve(requestId, reserved) && !fixture) { budgetExhausted = true; break; }
    const guidance = await requestGuidance(factualFirst.record, publicTargets, fixture, requestId, reserved);
    if (fixture) {
      fixtureTokenUsage = {
        inputTokens: fixtureTokenUsage.inputTokens + guidance.usage.inputTokens,
        outputTokens: fixtureTokenUsage.outputTokens + guidance.usage.outputTokens,
      };
    } else {
      budget.recordActual(requestId, guidance.usage);
    }
    const decision = enrichRecord(selection.record, facts, guidance.value);
    factualImports += decision.factualImportCount; reviewProposals += decision.reviewProposalCount; rejections += decision.rejections.length;
    if (decision.record.publicationStatus === "hidden") hiddenRecords += 1;
    if (decision.changed) changed.set(decision.record.lemma, decision.record);
    for (const rejection of decision.rejections) {
      const match = /^unknown target: (.+)$/.exec(rejection);
      if (match) unknownTargets += 1;
    }
  }
  const remaining = budget.remaining();
  const tokenUsage = fixture
    ? fixtureTokenUsage
    : { inputTokens: args.maxInputTokens - remaining.inputTokens, outputTokens: args.maxOutputTokens - remaining.outputTokens };
  await writeReport(args.reportPath, { stage: args.stage, factualImports, reviewProposals, hiddenRecords, rejections, unknownTargets, tokenUsage, estimatedRemainingDebt: Math.max(0, selected.length - changed.size) + (budgetExhausted ? 1 : 0) });
  if (!args.dryRun) {
    const shards = await writeVocabularyRecords(path.join(process.cwd(), "content", "vocabulary"), [...changed.values()]);
    console.log(`Updated shard(s): ${shards.join(", ") || "none"}`);
  }
  if (budgetExhausted) console.log(`Budget exhausted: remaining input ${remaining.inputTokens}, output ${remaining.outputTokens} tokens.`);
  console.log(`Imported ${factualImports} factual sense(s); proposed ${reviewProposals} review item(s); hidden ${hiddenRecords}; rejected ${rejections}; changed ${changed.size} record(s).`);
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
