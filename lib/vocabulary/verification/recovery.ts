import { createHash } from "node:crypto";
import { z } from "zod";
import { VocabularyRecordSchema, type VocabularyRecord, type VocabularySense } from "../schema";
import { containsVocabularyForm } from "./repair";
import { isFactualSourceId } from "../source-evidence";

export type RecoveryCandidate = { lemma: string; sense: VocabularySense; forms: string[] };
export const RecoveryDecisionSchema = z.object({ sense: z.number().int().nonnegative().nullable(), example: z.number().int().nonnegative().nullable() }).strict();
const POS: Record<string, string> = { noun: "noun", verb: "verb", adj: "adjective", adv: "adverb", pron: "pronoun", prep: "preposition", conj: "conjunction", det: "determiner", article: "article", intj: "interjection", num: "numeral", particle: "particle", phrase: "phrase" };
const EXCLUDED = new Set(["obsolete", "archaic", "abbreviation", "initialism", "acronym", "misspelling", "error", "nonstandard"]);
const INFLECTION = new Set(["plural", "singular", "past", "present", "participle", "third-person", "comparative", "superlative", "negative"]);
const obj = (v: unknown): Record<string, unknown> => v && typeof v === "object" && !Array.isArray(v) ? v as Record<string, unknown> : {};
const arr = (v: unknown): unknown[] => Array.isArray(v) ? v : [];
const strings = (v: unknown): string[] => arr(v).filter((x): x is string => typeof x === "string");
const hash = (v: unknown) => createHash("sha256").update(JSON.stringify(v)).digest("hex");
const CORE_GRAMMAR: Record<string, string[]> = {
  who: ["pronoun"], whom: ["pronoun"], whose: ["pronoun", "determiner"],
  what: ["pronoun", "determiner"], which: ["pronoun", "determiner"],
  when: ["adverb", "conjunction"], where: ["adverb", "conjunction"], why: ["adverb"], how: ["adverb"],
  because: ["conjunction"], if: ["conjunction"],
  may: ["verb"], might: ["verb"], can: ["verb"], could: ["verb"], should: ["verb"], shall: ["verb"], must: ["verb"], would: ["verb"], will: ["verb"],
  a: ["article", "determiner"], an: ["article", "determiner"], the: ["article", "determiner"],
};
export function learnerCandidates(record: Pick<VocabularyRecord, "lemma" | "tier">, candidates: RecoveryCandidate[]): RecoveryCandidate[] {
  const allowed = record.tier === "core" ? CORE_GRAMMAR[record.lemma] : undefined;
  return allowed ? candidates.filter(c => allowed.includes(c.sense.partOfSpeech)) : candidates;
}
const reviewSchema = z.object({ explains_word: z.literal(true), complete_sentence: z.literal(true), matching_sense_and_pos: z.literal(true), natural: z.literal(true) }).strict();
export function approvedRecoveryReview(value: unknown): boolean { return reviewSchema.safeParse(value).success; }

/** Raw dictionary prose is data, never instructions. Preserve it; never import external quotations. */
export function recoveryCandidates(lemma: string, entries: unknown[], edition: "en" | "simple", stamp: string): RecoveryCandidate[] {
  if (!/^[\p{L}\p{N}]/u.test(lemma)) return [];
  const result: RecoveryCandidate[] = [];
  for (const raw of entries) {
    const entry = obj(raw);
    if (entry.word !== lemma || entry.lang_code !== "en" || typeof entry.pos !== "string" || !POS[entry.pos]) continue;
    const entryTags = strings(entry.tags);
    if (entryTags.some(t => EXCLUDED.has(t))) continue;
    const forms = [...new Set([lemma, ...arr(entry.forms).flatMap(f => {
      const form = obj(f);
      return typeof form.form === "string" && /^[\p{L}\p{N}]/u.test(form.form)
        && strings(form.tags).some(t => INFLECTION.has(t)) ? [form.form] : [];
    })])];
    for (const rawSense of arr(entry.senses)) {
      const data = obj(rawSense);
      const labels = [...new Set([...entryTags, ...strings(data.tags)])];
      if (labels.some(t => EXCLUDED.has(t))) continue;
      const definition = strings(data.glosses).filter(s => s.trim()).join("\n");
      if (!definition || definition.length > 1600 || /definition pending/i.test(definition)
        || /^(?:plural|singular|past|present|third.person|comparative|superlative|alternative|inflected)\b[^.!?\n]*\bof\s+/i.test(definition)) continue;
      const partOfSpeech = POS[entry.pos]!;
      const identity = hash([edition, lemma, partOfSpeech, definition]);
      const source = {
        sourceId: "wiktionary", externalId: `${edition}:${lemma}:${identity.slice(0, 20)}`,
        url: `https://${edition}.wiktionary.org/wiki/${encodeURIComponent(lemma.replace(/ /g, "_"))}`,
        retrievedAt: stamp, contentHash: `sha256:${hash(data)}`,
        attribution: "Wiktionary contributors", license: "CC BY-SA 4.0",
        licenseUrl: "https://creativecommons.org/licenses/by-sa/4.0/",
      };
      const examples = arr(data.examples).flatMap(rawExample => {
        const e = obj(rawExample);
        if (e.ref || e.type === "quotation" || (e.type !== undefined && e.type !== "example")) return [];
        return typeof e.text === "string" && e.text.length <= 800 && containsVocabularyForm(e.text, { lemma, forms })
          ? [{ text: e.text, sources: [source] }] : [];
      }).slice(0, 8);
      result.push({ lemma, forms, sense: { id: `wiktionary:${identity.slice(0, 24)}`, partOfSpeech, definition,
        labels, examples, sources: [source], usagePatterns: [], collocations: [], commonMistakes: [], status: "review" } });
    }
  }
  return [...new Map(result.map(c => [c.sense.id, c])).values()];
}

/** Only an exact supplied decision can publish. Old IDs, memberships and edges never change. */
export function applyRecovery(record: VocabularyRecord, candidates: RecoveryCandidate[], decision: unknown): VocabularyRecord {
  const d = RecoveryDecisionSchema.safeParse(decision);
  if (!d.success || d.data.sense === null || d.data.example === null) return record;
  const candidate = candidates[d.data.sense];
  const example = candidate?.sense.examples[d.data.example];
  if (!candidate || candidate.lemma !== record.lemma || !example || !containsVocabularyForm(example.text, candidate)) return record;
  if (!learnerCandidates(record, [candidate]).length) return record;
  if (!candidate.sense.sources.some(s => isFactualSourceId(s.sourceId))
    || !example.sources.some(s => isFactualSourceId(s.sourceId) && s.url && s.license && s.attribution)) return record;
  const selected = { ...candidate.sense, examples: [example], status: "published" as const };
  const senses = [selected, ...record.senses.filter(s => s.id !== selected.id).map(s => s.status === "published" ? s : { ...s, status: "hidden" as const })];
  const sources = [...record.sources];
  for (const source of [...selected.sources, ...example.sources]) {
    if (!sources.some(s => s.sourceId === source.sourceId && s.url === source.url && s.contentHash === source.contentHash)) sources.push(source);
  }
  return VocabularyRecordSchema.parse({ ...record, senses, sources, partOfSpeech: selected.partOfSpeech,
    forms: [...new Set([...record.forms, ...candidate.forms])], status: "verified", publicationStatus: "published",
    ...(record.tier === "advanced" ? { verificationStatus: "published" } : {}),
  });
}
