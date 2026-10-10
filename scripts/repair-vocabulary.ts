/** Resumable, bounded factual repair. No generated definitions/examples or edge promotion. */
import "dotenv/config";
import { createHash } from "node:crypto";
import { mkdir, open, readFile, readdir, rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import WordPOS from "wordpos";
import { z } from "zod";
import { openNdjsonRepository, writeVocabularyRecords } from "../lib/vocabulary/ndjson-repository";
import type { VocabularyRecord } from "../lib/vocabulary/schema";
import { auditDictionaryRecords } from "../lib/wiki/dictionary-quality";
import { applyFactualRepair, containsVocabularyForm, needsFactualRepair, repairOrder } from "../lib/vocabulary/verification/repair";
import { lookupWordNetEvidence, type WordNetLookup } from "../lib/vocabulary/verification/wordnet-provider";
import { eligibleFactualSenses } from "../lib/vocabulary/verification/sense-verifier";
import { fetchTatoebaExamples } from "../lib/vocabulary/verification/http-providers";
import type { FactualDictionaryEvidence, SourcedExampleEvidence } from "../lib/vocabulary/verification/provider-types";
import { verificationCacheKey } from "../lib/vocabulary/verification/cache";
import { SpendLedger, worstCaseMicroCny } from "../lib/vocabulary/verification/spend-ledger";
import { completeJSONResult, LLM_ENDPOINT, LLM_MODEL, hasLLM } from "./llm-client";

const ROOT = path.resolve(".cache/vocabulary-repair");
const CONTENT = path.resolve("content/vocabulary");
const MAX_OUTPUT = 96;
const PROMPT = [
  "Match an English learner's word to one supplied dictionary sense and one supplied sentence.",
  "The sentence must use that exact word/form with that exact part of speech and meaning.",
  "Prefer clear ordinary usage; reject proper names, quoted word mentions and unrelated/uncertain meanings.",
  "Choose only zero-based array indexes. Never write or correct source content.",
  'Return JSON {"sense":0,"example":0} or {"sense":null,"example":null} if no confident match.',
].join("\n");
const choiceSchema = z.object({ sense: z.number().int().nonnegative().nullable(), example: z.number().int().nonnegative().nullable() }).strict();
const examplesSchema = z.array(z.object({
  id: z.string().min(1), text: z.string().min(1), language: z.literal("eng"),
  source: z.object({ sourceId: z.literal("tatoeba"), externalId: z.string().nullable(), url: z.url().nullable(), retrievedAt: z.string().nullable(), contentHash: z.string().nullable() }).strict(),
}).strict());
type Outcome = { lemma: string; tier: string; reason: string; changed: boolean; claimReady: boolean; published: boolean };
type Checkpoint = { version: 1; outcomes: Record<string, Outcome>; completed: boolean };
const hash = (text: string) => createHash("sha256").update(text).digest("hex");

async function save(file: string, value: unknown) {
  const full = path.join(ROOT, file);
  await mkdir(path.dirname(full), { recursive: true });
  const temp = `${full}.${process.pid}.tmp`;
  await writeFile(temp, JSON.stringify(value));
  await rename(temp, full);
}
async function load(file: string): Promise<unknown | null> {
  try { return JSON.parse(await readFile(path.join(ROOT, file), "utf8")); }
  catch (e) { if ((e as NodeJS.ErrnoException).code === "ENOENT") return null; throw e; }
}

async function acquireLock(): Promise<() => Promise<void>> {
  await mkdir(ROOT, { recursive: true });
  const file = path.join(ROOT, "worker.lock");
  try {
    const handle = await open(file, "wx");
    await handle.writeFile(String(process.pid));
    await handle.close();
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e;
    const pid = Number(await readFile(file, "utf8"));
    if (!Number.isSafeInteger(pid) || pid < 1) throw new Error("Invalid worker lock; inspect before resuming");
    try { process.kill(pid, 0); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error;
      await unlink(file); // Only this exact dead worker's lock, never corpus data.
      return acquireLock();
    }
    throw new Error(`Repair worker ${pid} is already active`);
  }
  return () => unlink(file);
}

async function oldSourceIndex() {
  const root = path.resolve(".cache/vocabulary-verification");
  const index = new Map<string, string>();
  let files: string[] = [];
  try { files = await readdir(root, { recursive: true }); } catch { return index; }
  for (const file of files.sort()) {
    if (!file.includes(`${path.sep}tatoeba${path.sep}`) || !file.endsWith(".json")) continue;
    index.set(path.basename(file, ".json"), path.join(root, file));
  }
  return index;
}

async function main() {
  const args = process.argv.slice(2);
  if (args.some(a => a !== "--write" && !/^--limit=\d+$/.test(a))) throw new Error("Use --write [--limit=N]");
  const write = args.includes("--write");
  const limit = Number(args.find(a => a.startsWith("--limit="))?.slice(8) ?? Infinity);
  if (!write) {
    const records: VocabularyRecord[] = [];
    for await (const record of openNdjsonRepository().all()) records.push(record);
    console.log(JSON.stringify({ mode: "plan-only, no paid calls or writes", core: records.filter(r => r.tier === "core").length, coreNeedingRepair: records.filter(r => r.tier === "core" && needsFactualRepair(r)).length, hiddenAdvanced: records.filter(r => r.tier === "advanced" && r.publicationStatus !== "published").length }));
    return;
  }
  if (!hasLLM() || new URL(LLM_ENDPOINT).origin !== "https://api.deepseek.com" || !["deepseek-v4-flash", "deepseek-flash"].includes(LLM_MODEL)) {
    throw new Error("This approved budget is only for configured DeepSeek Flash at api.deepseek.com");
  }
  const release = await acquireLock();
  try {
    const checkpoint = (await load("checkpoint.json") ?? { version: 1, outcomes: {}, completed: false }) as Checkpoint;
    if (checkpoint.version !== 1 || !checkpoint.outcomes) throw new Error("Invalid repair checkpoint");
    const ledger = new SpendLedger(path.join(ROOT, "spend.json"), 16);
    const records: VocabularyRecord[] = [];
    for await (const record of openNdjsonRepository().all()) records.push(record);
    if (!(await load("baseline-audit.json"))) await save("baseline-audit.json", auditDictionaryRecords(records));
    const candidates = records.filter(r => r.tier === "core" || r.publicationStatus !== "published").sort(repairOrder);
    // Candidate list is pinned before any content mutation, including promotions.
    const pinned = (await load("candidates.json") ?? candidates.map(r => r.lemma)) as string[];
    await save("candidates.json", pinned);
    const byLemma = new Map(records.map(r => [r.lemma, r]));
    const queue = pinned.filter(lemma => !checkpoint.outcomes[lemma]).slice(0, limit).map(lemma => {
      const record = byLemma.get(lemma);
      if (!record) throw new Error(`Pinned record disappeared: ${lemma}`);
      return record;
    });
    const oldIndex = await oldSourceIndex();
    const lookup = new WordPOS() as WordNetLookup;
    const retrievedAt = new Date().toISOString();
    let providerFailures = 0;
    let processed = Object.keys(checkpoint.outcomes).length;

    async function examplesFor(record: VocabularyRecord): Promise<SourcedExampleEvidence[]> {
      const file = `examples/${hash(JSON.stringify([record.lemma, record.forms]))}.json`;
      const own = await load(file);
      if (own !== null) return examplesSchema.parse(own);
      const key = verificationCacheKey({ provider: "tatoeba", version: "exact-lemma-v3", request: { lemma: record.lemma, partOfSpeech: record.partOfSpeech, forms: record.forms } }).split("/")[1]!;
      const oldPath = oldIndex.get(key);
      if (oldPath) {
        const parsed = examplesSchema.safeParse((JSON.parse(await readFile(oldPath, "utf8")) as { value: unknown }).value);
        if (parsed.success && parsed.data.length) { await save(file, parsed.data); return parsed.data; }
      }
      if (providerFailures >= 6) throw new Error("Tatoeba circuit breaker: six provider failures; resume after recovery");
      try {
        let examples = await fetchTatoebaExamples(record.lemma, record.forms);
        if (!examples.length) {
          for (const form of record.forms.filter(f => f !== record.lemma).slice(0, 2)) {
            examples = await fetchTatoebaExamples(form, [record.lemma, ...record.forms]);
            if (examples.length) break;
          }
        }
        providerFailures = 0;
        await save(file, examples);
        return examples;
      } catch (e) { providerFailures += 1; throw e; }
    }

    async function processRecord(original: VocabularyRecord) {
      let record = original;
      let reason = "already_ready";
      if (needsFactualRepair(record)) {
        let evidence = await lookupWordNetEvidence(record.lemma, record.partOfSpeech, { lookup, retrievedAt });
        if (!evidence) {
          const alternatives: FactualDictionaryEvidence[] = [];
          for (const pos of ["noun", "verb", "adjective", "adverb"].filter(p => p !== record.partOfSpeech)) {
            const e = await lookupWordNetEvidence(record.lemma, pos, { lookup, retrievedAt });
            if (e) alternatives.push(e);
          }
          if (alternatives.length === 1) {
            evidence = alternatives[0]!;
            record = { ...record, partOfSpeech: evidence.requestedPartOfSpeech };
          }
        }
        const sources = evidence ? [evidence] : [];
        const senses = eligibleFactualSenses(record, sources);
        let selection: Parameters<typeof applyFactualRepair>[2] = null;
        reason = senses.length ? "native_dictionary_example" : "no_factual_sense";
        if (senses.length && !senses.some(s => s.examples.length)) {
          const examples = (await examplesFor(record)).filter(e => containsVocabularyForm(e.text, record)).slice(0, 16);
          reason = examples.length ? "sense_ambiguous" : "no_sourced_example";
          if (examples.length) {
            const offered = senses.slice(0, 32);
            const user = JSON.stringify({ word: record.lemma, forms: record.forms, pos: record.partOfSpeech, senses: offered.map(s => s.definition), examples: examples.map(e => e.text) });
            const requestId = hash(JSON.stringify(["repair-finite-v1", LLM_MODEL, LLM_ENDPOINT, PROMPT, user]));
            let decision: unknown;
            const previous = ledger.entry(requestId);
            if (previous) {
              decision = previous.value;
              if (previous.status === "reserved") reason = "interrupted_request_not_repeated";
            } else if (ledger.reserve(requestId, worstCaseMicroCny(PROMPT + user, MAX_OUTPUT))) {
              const response = await completeJSONResult(PROMPT, user, LLM_MODEL, 1, {
                requestId, maxOutputTokens: MAX_OUTPUT, thinking: "disabled", jsonObject: true, sanitizeErrors: true,
                fallbackUsage: { inputTokens: Buffer.byteLength(PROMPT + user, "utf8") + 1024, outputTokens: MAX_OUTPUT },
              });
              decision = response?.value;
              ledger.finish(requestId, response?.usage ?? null, decision ?? null);
              if (!response) reason = "judge_unavailable";
            } else reason = "budget_exhausted";
            const parsed = choiceSchema.safeParse(decision);
            if (parsed.success && parsed.data.sense !== null && parsed.data.example !== null) {
              const sense = offered[parsed.data.sense], example = examples[parsed.data.example];
              if (sense && example) { selection = { senseId: sense.id, example }; reason = "matched_sourced_example"; }
            }
          }
        }
        record = applyFactualRepair(record, sources, selection);
      }
      const outcome: Outcome = {
        lemma: record.lemma, tier: record.tier, reason, changed: JSON.stringify(record) !== JSON.stringify(original),
        claimReady: record.senses.some(s => s.status === "published"), published: record.publicationStatus === "published",
      };
      return { record, outcome };
    }

    console.log(`Repair: ${queue.length} remaining / ${pinned.length} pinned; batch 25; concurrency 3; maximum charge ${(ledger.chargedMicroCny / 1e6).toFixed(4)} / 16 CNY`);
    for (let offset = 0; offset < queue.length; offset += 25) {
      const batch = queue.slice(offset, offset + 25);
      const results: Awaited<ReturnType<typeof processRecord>>[] = [];
      for (let index = 0; index < batch.length; index += 3) {
        // Wait for all siblings even on failure; never release the lock while a call is in flight.
        const group = await Promise.allSettled(batch.slice(index, index + 3).map(processRecord));
        const failure = group.find(r => r.status === "rejected");
        if (failure?.status === "rejected") throw failure.reason;
        for (const result of group) if (result.status === "fulfilled") results.push(result.value);
      }
      await writeVocabularyRecords(CONTENT, results.filter(r => r.outcome.changed).map(r => r.record));
      for (const { record, outcome } of results) {
        byLemma.set(record.lemma, record);
        checkpoint.outcomes[record.lemma] = outcome;
      }
      processed += results.length;
      await save("checkpoint.json", checkpoint);
      const ready = results.filter(r => r.outcome.claimReady).length;
      console.log(`${processed}/${pinned.length}: ${ready}/${results.length} ready in batch; maximum charge ${(ledger.chargedMicroCny / 1e6).toFixed(4)} CNY; last=${batch.at(-1)?.lemma}`);
    }
    checkpoint.completed = pinned.every(lemma => checkpoint.outcomes[lemma]);
    await save("checkpoint.json", checkpoint);
    const outcomes = Object.values(checkpoint.outcomes);
    const reasons: Record<string, number> = {};
    for (const o of outcomes) reasons[o.reason] = (reasons[o.reason] ?? 0) + 1;
    const report = {
      completed: checkpoint.completed, processed: outcomes.length, candidates: pinned.length,
      changed: outcomes.filter(o => o.changed).length, ready: outcomes.filter(o => o.claimReady).length,
      unresolved: outcomes.filter(o => !o.claimReady).map(o => ({ lemma: o.lemma, reason: o.reason })),
      reasons, maximumChargeCny: ledger.chargedMicroCny / 1e6,
      audit: auditDictionaryRecords([...byLemma.values()]),
    };
    await save("report.json", report);
    console.log(JSON.stringify({ ...report, unresolved: report.unresolved.length, audit: report.audit.total.strict }));
  } finally { await release(); }
}

main().catch(error => { console.error(error instanceof Error ? error.message : "Repair failed"); process.exitCode = 1; });
