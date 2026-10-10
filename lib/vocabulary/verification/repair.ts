import { isSenseContentReady } from "../publication";
import { VocabularyRecordSchema, type VocabularyRecord, type VocabularySense } from "../schema";
import { isFactualSourceId } from "../source-evidence";
import { importVerificationEvidence } from "./evidence-import";
import { eligibleFactualSenses } from "./sense-verifier";
import type { FactualDictionaryEvidence, SourcedExampleEvidence } from "./provider-types";

const LIST_ORDER = ["ngsl", "academic", "business", "toeic", "fitness"];

export function containsVocabularyForm(text: string, record: Pick<VocabularyRecord, "lemma" | "forms">): boolean {
  return [record.lemma, ...record.forms].some(form => {
    const escaped = form.normalize("NFC").replace(/_/g, " ").trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return escaped.length > 0 && new RegExp(`(?<![\\p{L}\\p{M}\\p{N}_])${escaped}(?![\\p{L}\\p{M}\\p{N}_])`, "iu").test(text.normalize("NFC"));
  });
}

export function repairSenseReady(record: VocabularyRecord, sense: VocabularySense): boolean {
  return isSenseContentReady(record, sense)
    && sense.sources.some(s => ["wordnet", "dictionaryapi", "curated"].includes(s.sourceId))
    && sense.examples.some(e => containsVocabularyForm(e.text, record) && e.sources.some(s => isFactualSourceId(s.sourceId)));
}

export function needsFactualRepair(record: VocabularyRecord): boolean {
  return record.publicationStatus !== "published"
    || !record.senses.some(s => s.status === "published" && repairSenseReady(record, s))
    || record.senses.some(s => s.status === "published" && !repairSenseReady(record, s));
}

export function repairOrder(a: VocabularyRecord, b: VocabularyRecord): number {
  const stage = (r: VocabularyRecord) => r.tier === "advanced" ? LIST_ORDER.length
    : LIST_ORDER.findIndex(list => r.lists.some(m => m.id === list));
  const sa = stage(a), sb = stage(b);
  if (sa !== sb) return sa - sb;
  const ma = a.lists.find(m => m.id === LIST_ORDER[sa]);
  const mb = b.lists.find(m => m.id === LIST_ORDER[sb]);
  return (mb?.sfi ?? -1) - (ma?.sfi ?? -1)
    || (ma?.rank ?? Infinity) - (mb?.rank ?? Infinity)
    || a.lemma.localeCompare(b.lemma);
}

/** Native dictionary examples need no LLM; external examples need an exact finite selection. */
export function applyFactualRepair(
  record: VocabularyRecord,
  evidence: readonly FactualDictionaryEvidence[],
  selection: { senseId: string; example: SourcedExampleEvidence } | null,
): VocabularyRecord {
  const eligible = eligibleFactualSenses(record, evidence);
  if (selection && (!eligible.some(s => s.id === selection.senseId) || !containsVocabularyForm(selection.example.text, record))) {
    throw new Error("Repair selection is not exact supplied evidence");
  }
  const imported = importVerificationEvidence(record, evidence, selection?.senseId ?? null, selection?.example ?? null);
  const approved = new Set(eligible.filter(s => s.examples.length > 0).map(s => s.id));
  if (selection) approved.add(selection.senseId);
  const senses = imported.senses.map(sense => {
    const ready = repairSenseReady(imported, sense);
    const status = ready && (sense.status === "published" || approved.has(sense.id))
      ? "published" as const
      : sense.sources.some(s => isFactualSourceId(s.sourceId)) ? "review" as const : "hidden" as const;
    return { ...sense, status };
  }).sort((a, b) => Number(b.status === "published") - Number(a.status === "published"));
  const ready = senses.some(s => s.status === "published");
  return VocabularyRecordSchema.parse({
    ...imported, senses,
    ...(ready ? { status: "verified" } : {}),
    ...(record.tier === "advanced" ? {
      publicationStatus: ready ? "published" : "hidden",
      verificationStatus: ready ? "published" : record.verificationStatus ?? "ambiguous",
    } : {}),
  });
}
