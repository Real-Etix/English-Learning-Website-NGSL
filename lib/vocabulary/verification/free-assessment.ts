import { createHash } from "node:crypto";
import { z } from "zod";
import { applyEditorialDecision } from "../editorial";
import { EditorialDecisionSchema, VocabularyRecordSchema, type ContentSourceRef, type VocabularyRecord, type VocabularySense } from "../schema";
import { isFactualSourceId } from "../source-evidence";
import { recoveryCandidates } from "./recovery";
import { readBounded } from "./recovery-io";
import { openEnglishWordnetCandidates } from "./open-english-wordnet";

export const recordHash = (record: VocabularyRecord) => createHash("sha256").update(JSON.stringify(record)).digest("hex");
export const FreeReviewSchema = z.object({
  beforeHash: z.string().regex(/^[a-f0-9]{64}$/),
  editorial: EditorialDecisionSchema,
  importSenseIds: z.array(z.string()),
}).strict();
export type FreeReview = z.infer<typeof FreeReviewSchema>;

export function parseFreeAssessmentArgs(args: string[]): { write: boolean; requests: number } {
  const allowed = /^(?:--write|--max-source-requests=(?:0|[1-9]\d*))$/;
  if (args.some(a => !allowed.test(a)) || new Set(args.map(a => a.split("=")[0])).size !== args.length) throw new Error("Use [--write] [--max-source-requests=0..1263]");
  const requests = Number(args.find(a => a.startsWith("--max-source-requests="))?.split("=")[1] ?? 0);
  if (requests > 1263) throw new Error("Source request limit exceeds pinned candidate count");
  return { write: args.includes("--write"), requests };
}

const wikiEntry = z.object({ word: z.string(), lang_code: z.string(), senses: z.array(z.unknown()).optional() }).passthrough();
export type CachedLexicalRelation = { senseId: string; type: string; target: string; source: ContentSourceRef };
export type CachedUsageEvidence = {
  senseId: string;
  field: "tags" | "raw_tags" | "qualifier" | "topics";
  scope: "entry" | "sense";
  text: string;
  source: ContentSourceRef;
  status: "review";
};
const array = (value: unknown): unknown[] => Array.isArray(value) ? value : [];
const nonblankStrings = (value: unknown) => array(value).filter((v): v is string => typeof v === "string" && Boolean(v.trim()));
const rawHash = (value: unknown) => `sha256:${createHash("sha256").update(JSON.stringify(value)).digest("hex")}`;
const unique = <T>(values: T[]): T[] => [...new Map(values.map(value => [JSON.stringify(value), value])).values()];

export function cachedWiktionaryEvidence(headword: string, entries: unknown[], stamp: string) {
  const candidates = recoveryCandidates(headword, entries, "en", stamp);
  const relations: CachedLexicalRelation[] = [];
  const usage: CachedUsageEvidence[] = [];
  for (const raw of entries) {
    const entry = wikiEntry.safeParse(raw);
    if (!entry.success || entry.data.word !== headword || entry.data.lang_code !== "en") continue;
    // Scope matching to the original entry (including POS), then to the retained
    // candidate version. Equal raw sense text in two POS entries is not one sense.
    const localCandidates = recoveryCandidates(headword, [raw], "en", stamp).filter(local =>
      candidates.some(c => c.sense.id === local.sense.id && c.sense.sources[0]?.contentHash === local.sense.sources[0]?.contentHash));
    for (const rawSense of entry.data.senses ?? []) {
      if (!rawSense || typeof rawSense !== "object" || Array.isArray(rawSense)) continue;
      const data = rawSense as Record<string, unknown>;
      const candidate = localCandidates.find(c => c.sense.sources[0]?.contentHash === rawHash(rawSense));
      if (!candidate) continue;
      const source = candidate.sense.sources[0];
      const senseId = candidate.sense.id;
      // Entry tags apply across this POS entry, and need an entry-level hash.
      // Entry-wide free-form notes/relations lack reliable sense binding: omit.
      for (const text of nonblankStrings(entry.data.tags)) usage.push({ senseId, scope: "entry", field: "tags", text, source: { ...source, contentHash: rawHash(raw) }, status: "review" });
      for (const field of ["tags", "raw_tags", "qualifier", "topics"] as const) {
        const texts = nonblankStrings(field === "qualifier" ? [data[field]] : data[field]);
        for (const text of texts) usage.push({ senseId, scope: "sense", field, text, source, status: "review" });
      }
      for (const [field, type] of Object.entries({ synonyms: "synonym", antonyms: "antonym", hypernyms: "hypernym", hyponyms: "hyponym", related: "related" })) {
        for (const item of array(data[field])) {
          const word = z.object({ word: z.string().min(1).refine(v => Boolean(v.trim())) }).safeParse(item);
          if (word.success) relations.push({ senseId, type, target: word.data.word, source });
        }
      }
    }
  }
  return {
    senses: candidates.map(c => c.sense), forms: [...new Set(candidates.flatMap(c => c.forms))],
    topics: [...new Set(usage.filter(u => u.field === "topics").map(u => u.text))],
    relations: unique(relations), usage: unique(usage),
  };
}

export function summarizeFreeUsage(entries: { currentVisibility: "published" | "hidden" | "archived"; wikiUsage: CachedUsageEvidence[] }[]) {
  return {
    currentPublic: entries.filter(e => e.currentVisibility === "published").length,
    currentHidden: entries.filter(e => e.currentVisibility !== "published").length,
    currentArchived: entries.filter(e => e.currentVisibility === "archived").length,
    usageEvidenceItems: entries.reduce((sum, e) => sum + e.wikiUsage.length, 0),
    wordsWithUsageEvidence: entries.filter(e => e.wikiUsage.length).length,
    hiddenWithUsageEvidence: entries.filter(e => e.currentVisibility !== "published" && e.wikiUsage.length).length,
    wordsWithUsageNotes: entries.filter(e => e.wikiUsage.some(u => u.field === "qualifier" || u.field === "raw_tags")).length,
  };
}

type FreeCache = {
  load(key: string): Promise<unknown | null>;
  save(key: string, value: unknown): Promise<void>;
  request(url: string): Promise<Response>;
};
export async function lookupFreeWordnet(headword: string, cache: FreeCache, allowRequest: boolean): Promise<{ status: "found" | "no_match" | "not_requested"; senses: VocabularySense[]; requested: boolean }> {
  const key = `oewn-api-v1:${headword}`;
  let cached = await cache.load(key);
  let requested = false;
  if (cached === null) {
    if (!allowRequest) return { status: "not_requested", senses: [], requested };
    const response = await cache.request(`https://en-word.net/api/lemma/${encodeURIComponent(headword)}`);
    requested = true;
    if (!response.ok) { await response.body?.cancel(); throw new Error(`OEWN HTTP ${response.status}`); }
    const payload: unknown = JSON.parse(await readBounded(response, 2 * 1024 * 1024));
    const retrievedAt = new Date().toISOString();
    openEnglishWordnetCandidates(headword, payload, retrievedAt); // validate before caching
    cached = { retrievedAt, payload };
    await cache.save(key, cached);
  }
  const envelope = z.object({ retrievedAt: z.iso.datetime(), payload: z.unknown() }).strict().parse(cached);
  const senses = openEnglishWordnetCandidates(headword, envelope.payload, envelope.retrievedAt);
  return { status: senses.length ? "found" : "no_match", senses, requested };
}

export function applyFreeAssessmentReview(record: VocabularyRecord, input: FreeReview, candidates: VocabularySense[], records: Iterable<VocabularyRecord>): VocabularyRecord {
  const decision = FreeReviewSchema.parse(input);
  const next = applyEditorialDecision(record, decision.editorial, records);
  for (const id of decision.importSenseIds) {
    if (next.senses.some(s => s.id === id)) continue;
    const candidate = candidates.find(s => s.id === id);
    if (!candidate || !candidate.sources.some(s => isFactualSourceId(s.sourceId))) throw new Error(`Missing factual sense ${id}`);
    next.senses.push({ ...candidate, status: "review" });
    for (const source of candidate.sources) if (!next.sources.some(s => s.sourceId === source.sourceId && s.externalId === source.externalId && s.contentHash === source.contentHash)) next.sources.push(source);
  }
  const parsed = VocabularyRecordSchema.parse(next);
  if (recordHash(parsed) !== recordHash(record) && recordHash(record) !== decision.beforeHash) throw new Error(`Record changed since review: ${record.lemma}`);
  return parsed;
}
