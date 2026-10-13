import "dotenv/config";
import { createHash } from "node:crypto";
import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { openNdjsonRepository, writeVocabularyRecords } from "../lib/vocabulary/ndjson-repository";
import type { VocabularyRecord } from "../lib/vocabulary/schema";
import { acquireRecoveryLock } from "../lib/vocabulary/verification/recovery-io";
import { recoveryContentIssue } from "../lib/vocabulary/verification/recovery";
import { QUALITY_PROMPT, parseQualityDecision, quarantineRecoveredSense, editorialAction, type QualityDecision } from "../lib/vocabulary/verification/recovery-quality";
import { SpendLedger, worstCaseMicroCny } from "../lib/vocabulary/verification/spend-ledger";
import { completeJSONResult, hasLLM, LLM_ENDPOINT, LLM_MODEL } from "./llm-client";
import { PILOT, validateJournal } from "./recover-vocabulary";

const ROOT = path.resolve(".cache/vocabulary-repair");
const V2 = path.join(ROOT, "recovery-v2");
const hash = (v: unknown) => createHash("sha256").update(JSON.stringify(v)).digest("hex");
const MAX_OUTPUT = 128;
type Outcome = { reason: string; changed: boolean; afterHash: string; tier: string; [key: string]: unknown };
type State = { version: 2; candidates: { lemma: string; beforeHash: string }[]; outcomes: Record<string, Outcome> };
type Receipt = { lemma: string; recordHash: string; decision: QualityDecision };
type JournalRow = { lemma: string; beforeHash: string; afterHash: string; record: VocabularyRecord; outcome: Outcome };
export function parseReviewArgs(args: string[]): "plan" | "pilot" | "flags" | "apply" {
  if (!args.length) return "plan";
  if (args.length === 1 && args[0] === "--pilot") return "pilot";
  if (args.length === 1 && args[0] === "--flags") return "flags";
  if (args.length === 1 && args[0] === "--apply") return "apply";
  throw new Error("Use --flags (suggestions only), --apply (reviewed decisions only), --pilot, or no arguments. Automatic --write is disabled.");
}
export function qualityReceiptKey(lemma: string, recordHash: string, prompt = QUALITY_PROMPT): string {
  return hash([lemma, recordHash, prompt]);
}
async function readJson<T>(file: string): Promise<T | null> {
  try { return JSON.parse(await readFile(file, "utf8")); }
  catch (e) { if ((e as NodeJS.ErrnoException).code === "ENOENT") return null; throw e; }
}
async function saveJson(file: string, value: unknown) {
  await mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  await writeFile(tmp, JSON.stringify(value));
  await rename(tmp, file);
}
async function main() {
  const mode = parseReviewArgs(process.argv.slice(2));
  if (mode === "plan") { console.log("No calls or writes. --flags creates suggestions without editing vocabulary; --apply applies exact agent-reviewed decisions offline."); return; }
  if (mode !== "apply" && (!hasLLM() || new URL(LLM_ENDPOINT).origin !== "https://api.deepseek.com" || !["deepseek-v4-flash", "deepseek-flash"].includes(LLM_MODEL))) throw new Error("Only configured DeepSeek Flash is approved");
  const release = await acquireRecoveryLock(ROOT);
  let releaseV2: (() => Promise<void>) | undefined;
  try {
    releaseV2 = await acquireRecoveryLock(V2);
    if (await readJson(path.join(V2, "pending-batch.json"))) throw new Error("Resume the recovery worker's pending journal first");
    const stateFile = path.join(V2, "checkpoint.json");
    const state = await readJson<State>(stateFile);
    if (!state || state.version !== 2) throw new Error("Original recovery checkpoint required");
    if (mode !== "pilot") {
      const approval = await readJson<{ mode: string; approved: boolean }>(path.join(V2, "quality-mode-approval.json"));
      if (!approval?.approved || approval.mode !== "flags-only-with-agent-review") throw new Error("Explicit flags-only plus agent-review approval required");
    }
    const records = new Map<string, VocabularyRecord>();
    for await (const r of openNdjsonRepository().all()) records.set(r.lemma, r);
    const journalFile = path.join(V2, "quality-pending.json");
    async function applyJournal(rows: JournalRow[]) {
      validateJournal(rows, new Map([...records].map(([lemma, r]) => [lemma, hash(r)])));
      for (const row of rows) {
        if (row.record.lemma !== row.lemma || hash(row.record) !== row.afterHash || row.outcome.afterHash !== row.afterHash
          || !state!.candidates.some(c => c.lemma === row.lemma) || row.outcome.reason !== "quality_rejected") throw new Error("Invalid quality journal");
      }
      await writeVocabularyRecords(path.resolve("content/vocabulary"), rows.map(r => r.record));
      for (const row of rows) { state!.outcomes[row.lemma] = row.outcome; records.set(row.lemma, row.record); }
      await saveJson(stateFile, state);
      await unlink(journalFile);
    }
    const interrupted = await readJson<JournalRow[]>(journalFile);
    if (interrupted) {
      if (mode !== "apply") throw new Error("Resume the quality application journal with --apply; flags mode never changes vocabulary");
      await applyJournal(interrupted);
    }
    const ledger = new SpendLedger(path.join(ROOT, "spend.json"), 16);
    async function assess(r: VocabularyRecord): Promise<QualityDecision> {
      const s = r.senses[0];
      if (!s?.examples[0]) throw new Error(`Missing recovered pair: ${r.lemma}`);
      const issue = recoveryContentIssue(s.definition, s.examples[0].text);
      if (issue) return { issue: issue === "bare_inflection" ? "definition_quality" : "quotation", reason: issue };
      const user = JSON.stringify({ word: r.lemma, pos: s.partOfSpeech, definition: s.definition, example: s.examples[0].text });
      for (let attempt = 1; attempt <= 3; attempt++) {
        const key = hash(["recovery-quality-v1", LLM_MODEL, QUALITY_PROMPT, user, attempt]);
        const existing = ledger.entry(key);
        if (existing) {
          const decision = existing.status === "complete" ? parseQualityDecision(existing.value) : null;
          if (decision) return decision;
          continue; // Interrupted calls remain charged at their full reservation.
        }
        if (!ledger.reserve(key, worstCaseMicroCny(QUALITY_PROMPT + user, MAX_OUTPUT))) throw new Error("Cumulative spending ceiling reached; do not publish unreviewed results");
        const response = await completeJSONResult(QUALITY_PROMPT, user, LLM_MODEL, 1, { requestId: key, maxOutputTokens: MAX_OUTPUT, thinking: "disabled", jsonObject: true, sanitizeErrors: true,
          fallbackUsage: { inputTokens: Buffer.byteLength(QUALITY_PROMPT + user) + 1024, outputTokens: MAX_OUTPUT } });
        ledger.finish(key, response?.usage ?? null, response?.value ?? null);
        const decision = parseQualityDecision(response?.value);
        if (decision) return decision;
      }
      throw new Error(`Quality reviewer unavailable after three conservatively charged attempts: ${r.lemma}`);
    }
    const pilotFile = path.join(V2, "quality-pilot.json");
    if (mode === "pilot") {
      const cases = { markdown: "sense_mismatch", matriculate: "definition_quality", confection: "definition_quality", who: "none", when: "none", because: "none", may: "none", mains: "none", masterwork: "none" };
      const results = [];
      for (const [lemma, expected] of Object.entries(cases)) {
        const r = records.get(lemma);
        if (!r) throw new Error(`Missing calibration case: ${lemma}`);
        const decision = await assess(r);
        results.push({ lemma, expected, recordHash: hash(r), decision });
        console.log(JSON.stringify({ lemma, expected, decision }));
      }
      const passed = results.every(r => r.expected === r.decision.issue);
      await saveJson(pilotFile, { promptHash: hash(QUALITY_PROMPT), passed, results, cumulativeMaximumCny: ledger.chargedMicroCny / 1e6 });
      if (!passed) throw new Error("Quality calibration failed; do not roll out this reviewer");
      return;
    }
    // The failed automatic-critic calibration stays on disk. The user approved
    // suggestions followed by agent review, NOT treating model flags as decisions.
    if (state.candidates.some(c => !state.outcomes[c.lemma])) throw new Error("Finish every recovery assessment before the final quality pass");
    const receiptsFile = path.join(V2, "quality-receipts.json");
    const receipts = await readJson<Record<string, Receipt>>(receiptsFile) ?? {};
    const recovered = Object.entries(state.outcomes).filter(([, o]) => o.reason === "recovered").map(([lemma, o]) => {
      const r = records.get(lemma);
      if (!r || hash(r) !== o.afterHash) throw new Error(`Changed recovered record: ${lemma}`);
      return r;
    });
    const queue = mode === "flags" ? recovered.filter(r => !receipts[qualityReceiptKey(r.lemma, hash(r))]) : [];
    for (let offset = 0; offset < queue.length; offset += 3) {
      const group = await Promise.allSettled(queue.slice(offset, offset + 3).map(async r => ({ lemma: r.lemma, recordHash: hash(r), decision: await assess(r) })));
      for (const result of group) if (result.status === "fulfilled") {
        const receipt = result.value;
        receipts[qualityReceiptKey(receipt.lemma, receipt.recordHash)] = receipt;
      }
      await saveJson(receiptsFile, receipts);
      const failure = group.find(r => r.status === "rejected");
      if (failure?.status === "rejected") throw failure.reason;
      if (offset % 24 === 0) console.log(JSON.stringify({ qualityReviewed: Object.keys(receipts).length, recovered: recovered.length, cumulativeMaximumCny: ledger.chargedMicroCny / 1e6 }));
    }
    if (mode === "flags") {
      const flagged = recovered.filter(r => receipts[qualityReceiptKey(r.lemma, hash(r))]?.decision.issue !== "none");
      console.log(JSON.stringify({ mode: "flags-only", assessed: recovered.length, flagged: flagged.length, canonicalChanges: 0, cumulativeMaximumCny: ledger.chargedMicroCny / 1e6 }));
      return;
    }
    const editorial = await readJson<Record<string, unknown>>(path.join(V2, "quality-editorial.json")) ?? {};
    const rows: JournalRow[] = [];
    for (const r of recovered) {
      const receipt = receipts[qualityReceiptKey(r.lemma, hash(r))];
      if (!receipt || receipt.lemma !== r.lemma || receipt.recordHash !== hash(r) || !parseQualityDecision(receipt.decision)) throw new Error(`Missing or stale quality flag: ${r.lemma}`);
      const key = qualityReceiptKey(r.lemma, hash(r));
      if (editorialAction(r.lemma, hash(r), receipt.decision, editorial[key]) === "keep") {
        if (recoveryContentIssue(r.senses[0]!.definition, r.senses[0]!.examples[0]!.text)) throw new Error(`Deterministic source gate still blocks: ${r.lemma}`);
        continue;
      }
      const updated = quarantineRecoveredSense(r, r.senses[0]!.id);
      const outcome = { ...state.outcomes[r.lemma]!, reason: "quality_rejected", qualityIssue: receipt.decision, qualityInputHash: hash(r), editorialDecision: editorial[key], changed: true, afterHash: hash(updated) };
      rows.push({ lemma: r.lemma, beforeHash: hash(r), afterHash: hash(updated), record: updated, outcome });
    }
    await saveJson(journalFile, rows);
    await applyJournal(rows);
    const counts: Record<string, number> = {};
    for (const o of Object.values(state.outcomes)) counts[o.reason] = (counts[o.reason] ?? 0) + 1;
    const report = { processed: Object.keys(state.outcomes).length, total: state.candidates.length, counts, cumulativeMaximumCny: ledger.chargedMicroCny / 1e6,
      pilotHash: hash(PILOT.map(lemma => [lemma, state.outcomes[lemma]])), outcomes: state.outcomes };
    await saveJson(path.join(V2, "report.json"), report);
    console.log(JSON.stringify({ ...report, outcomes: undefined, quarantined: rows.length }));
  } finally { if (releaseV2) await releaseV2(); await release(); }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) void main().catch(e => { console.error(e instanceof Error ? e.message : "Quality audit failed"); process.exitCode = 1; });
