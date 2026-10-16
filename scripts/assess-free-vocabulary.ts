/** No LLM imports, credentials or automatic publication: free evidence + pinned editorial decisions. */
import { createHash } from "node:crypto";
import { mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { openNdjsonRepository, writeVocabularyRecords } from "../lib/vocabulary/ndjson-repository";
import { dictionaryHeadword } from "../lib/vocabulary/editorial";
import { isWordPublic } from "../lib/vocabulary/publication";
import type { VocabularyRecord, VocabularySense } from "../lib/vocabulary/schema";
import { acquireRecoveryLock, RecoveryCache } from "../lib/vocabulary/verification/recovery-io";
import { applyFreeAssessmentReview, cachedWiktionaryEvidence, FreeReviewSchema, lookupFreeWordnet, parseFreeAssessmentArgs, recordHash, summarizeFreeUsage, type CachedLexicalRelation, type CachedUsageEvidence } from "../lib/vocabulary/verification/free-assessment";

const ROOT = path.resolve(".cache/vocabulary-repair");
const PRIOR = path.join(ROOT, "recovery-v2");
const OUT = path.join(ROOT, "free-improvement-v1");
const REVIEWS = path.resolve("content/vocabulary/editorial-decisions.json");
const pilot = new Map([
  ["foodprocessor", "food processor"], ["associationfootball", "association football"],
  ["healthclub", "health club"], ["spinalcolumn", "spinal column"], ["vertebralcolumn", "vertebral column"],
  ["softwareengineer", "software engineer"], ["grammaticalgender", "grammatical gender"],
  ["decimalfraction", "decimal fraction"], ["cubicdecimeter", "cubic decimeter"], ["metricton", "metric ton"],
  ["perannum", "per annum"], ["denovo", "de novo"], ["horsd'oeuvre", "hors d'oeuvre"],
  ["doppelgnger", "doppelgänger"], ["canap", "canapé"], ["businessday", "business day"],
  ...["absorbedly", "appropriateness", "aftermarket", "aponeurosis", "acylglycerol", "anopheline", "allotherian", "actinic", "alveolus"].map(w => [w, w] as const),
]);
const checkpointSchema = z.object({ outcomes: z.record(z.string(), z.object({ tier: z.string(), reason: z.string() }).passthrough()) }).passthrough();
const reviewsSchema = z.object({ version: z.literal(1), entries: z.record(z.string(), FreeReviewSchema) }).strict();
const digest = (s: string) => createHash("sha256").update(s).digest("hex");
async function json(file: string) { return JSON.parse(await readFile(file, "utf8")) as unknown; }
async function save(file: string, value: unknown) {
  const temp = `${file}.${process.pid}.tmp`;
  await writeFile(temp, JSON.stringify(value, null, 2)); await rename(temp, file);
}
type Assessment = {
  lemma: string; blocker: string; beforeHash: string; headword: string;
  decisionStatus: "reviewed" | "needs_review";
  currentVisibility: "published" | "hidden" | "archived";
  topics: string[]; forms: string[]; wikiSenses: VocabularySense[]; oewnSenses: VocabularySense[];
  lexicalRelations: CachedLexicalRelation[];
  wikiUsage: CachedUsageEvidence[];
  oewnStatus: string; anchors: { lemma: string; lists: string[]; gloss: string | null }[];
};

export async function main(args = process.argv.slice(2)) {
  const options = parseFreeAssessmentArgs(args);
  const release = await acquireRecoveryLock(ROOT);
  try {
    await mkdir(OUT, { recursive: true });
    const checkpoint = checkpointSchema.parse(await json(path.join(PRIOR, "checkpoint.json")));
    const ids = Object.entries(checkpoint.outcomes).filter(([, v]) => v.tier === "advanced" && v.reason !== "recovered").map(([id]) => id);
    if (ids.length !== 1263) throw new Error("Expected the approved pinned remainder of 1263 records");
    const records: VocabularyRecord[] = [];
    for await (const record of openNdjsonRepository().all()) records.push(record);
    const byId = new Map(records.map(r => [r.lemma, r]));
    for (const id of ids) if (byId.get(id)?.tier !== "advanced") throw new Error(`Missing advanced candidate ${id}`);
    const reviews = reviewsSchema.parse(await json(REVIEWS));
    if (Object.keys(reviews.entries).some(id => !ids.includes(id))) throw new Error("Editorial decision outside approved remainder");
    const cache = new RecoveryCache(path.join(OUT, "sources"));
    let requests = 0, lastRequest = 0, consecutiveFailures = 0;
    const port = {
      load: cache.load.bind(cache), save: cache.save.bind(cache),
      request: async (url: string) => {
        if (new URL(url).origin !== "https://en-word.net" || !new URL(url).pathname.startsWith("/api/lemma/")) throw new Error("Unapproved free source endpoint");
        if (requests >= options.requests) throw new Error("Request ceiling reached");
        await new Promise(resolve => setTimeout(resolve, Math.max(0, 1100 - (Date.now() - lastRequest))));
        lastRequest = Date.now(); requests++;
        return fetch(url, { signal: AbortSignal.timeout(25000), redirect: "error", headers: { "User-Agent": "NGSLVocabularyRecovery/1.0" } });
      },
    };
    // Evidence candidates are deterministic on cached retrieval timestamps. No
    // failure/timeout is recorded as proof that a dictionary lacks the word.
    const order = [...pilot.keys(), ...ids.filter(id => !pilot.has(id)).sort()];
    const entries: Assessment[] = [];
    for (const id of order) {
      if (!ids.includes(id)) continue;
      const record = byId.get(id)!;
      const headword = reviews.entries[id]?.editorial.headword?.value ?? pilot.get(id) ?? dictionaryHeadword(record);
      const file = path.join(PRIOR, "sources", digest(`english-wiktextract-v2:${headword}`) + ".json");
      let wiki: ReturnType<typeof cachedWiktionaryEvidence> = { senses: [], forms: [], topics: [], relations: [], usage: [] };
      try {
        const envelope = z.object({ key: z.literal(`english-wiktextract-v2:${headword}`), value: z.array(z.unknown()) }).parse(await json(file));
        wiki = cachedWiktionaryEvidence(headword, envelope.value, (await stat(file)).mtime.toISOString());
      } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
      let oewnStatus = "not_requested", oewnSenses: VocabularySense[] = [];
      try {
        const result = await lookupFreeWordnet(headword, port, requests < options.requests && consecutiveFailures < 3);
        oewnStatus = result.status; oewnSenses = result.senses;
        if (result.requested) consecutiveFailures = 0;
      } catch (error) {
        consecutiveFailures++; oewnStatus = `source_unavailable: ${error instanceof Error ? error.message.slice(0, 100) : "unknown"}`;
      }
      entries.push({ lemma: id, blocker: checkpoint.outcomes[id]!.reason, beforeHash: recordHash(record), headword,
        decisionStatus: reviews.entries[id] ? "reviewed" : "needs_review",
        currentVisibility: record.editorial?.scope?.status === "archived" ? "archived" : isWordPublic(record) ? "published" : "hidden",
        topics: wiki.topics, forms: wiki.forms, wikiSenses: wiki.senses, lexicalRelations: wiki.relations, oewnSenses, oewnStatus,
        wikiUsage: wiki.usage,
        anchors: record.connections.filter(c => c.type === "builds_on").map(c => ({ lemma: c.target, lists: byId.get(c.target)?.lists.map(l => l.id) ?? [], gloss: c.gloss })),
      });
    }
    const updates: VocabularyRecord[] = [];
    const rows = new Map(entries.map(e => [e.lemma, e]));
    // Compute and validate every reviewed change before writing any shard.
    for (const [id, decision] of Object.entries(reviews.entries)) {
      const record = byId.get(id)!; const row = rows.get(id)!;
      const updated = applyFreeAssessmentReview(record, decision, [...row.wikiSenses, ...row.oewnSenses], byId.values());
      if (recordHash(updated) !== recordHash(record)) updates.push(updated);
      byId.set(id, updated);
    }
    const changedShards = options.write ? await writeVocabularyRecords(path.resolve("content/vocabulary"), updates) : [];
    const summary = {
      mode: options.write ? "reviewed-write" : "assessment-only", assessed: entries.length, requests, paidCalls: 0,
      ...summarizeFreeUsage(entries),
      cachedWikiDefinitions: entries.filter(e => e.wikiSenses.length).length,
      cachedLexicalRelations: entries.reduce((sum, e) => sum + e.lexicalRelations.length, 0),
      reviewedRecords: Object.keys(reviews.entries).length,
      archivedRecords: Object.values(reviews.entries).filter(d => d.editorial.scope?.status === "archived").length,
      oewnFound: entries.filter(e => e.oewnSenses.length).length,
      oewnWithTargetExamples: entries.filter(e => e.oewnSenses.some(s => s.examples.length)).length,
      oewnFailures: entries.filter(e => e.oewnStatus.startsWith("source_unavailable")).length,
      reviewedChanges: updates.length, applied: options.write ? updates.length : 0, changedShards,
    };
    await save(path.join(OUT, "report.json"), { generatedAt: new Date().toISOString(), summary, entries });
    console.log(JSON.stringify(summary, null, 2));
    if (consecutiveFailures >= 3) console.warn("Source circuit opened after three failures; cached assessment completed without further requests.");
  } finally { await release(); }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) main().catch(error => { console.error(error instanceof Error ? error.message : "Assessment failed"); process.exitCode = 1; });
