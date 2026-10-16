import { EditorialDecisionSchema, VocabularyRecordSchema, type EditorialDecision, type VocabularyRecord } from "./schema";

const normalized = (value: string) => value.normalize("NFC").toLowerCase().trim().replace(/\s+/gu, " ");
const punctuationKey = (value: string) => normalized(value).replace(/[\s-]/gu, "");
const collisionKey = (value: string) => punctuationKey(value).normalize("NFD").replace(/\p{M}/gu, "");

/** A corrected display is not a new record: stable IDs and collection keys survive. */
export function dictionaryHeadword(record: VocabularyRecord): string {
  return record.editorial?.headword?.value ?? record.lemma;
}

export function applyEditorialDecision(record: VocabularyRecord, input: EditorialDecision, records: Iterable<VocabularyRecord>): VocabularyRecord {
  if (record.tier === "core") throw new Error("Official core entries cannot be changed by advanced editorial decisions");
  const decision = EditorialDecisionSchema.parse(input);
  const metadata = { ...record.editorial, ...decision };
  let display = record.display;
  let forms = record.forms;
  if (decision.headword) {
    const value = normalized(decision.headword.value);
    // Explicit editorial receipts can reverse historical loss or repair spacing/
    // hyphens. This never authorizes letter substitutions or a synonym rename.
    if (value.replace(/[^a-z'-]/g, "") !== record.lemma && punctuationKey(value) !== punctuationKey(record.lemma)) throw new Error("Correction is not the same historical word identity");
    for (const other of records) {
      if (other.lemma !== record.lemma && [other.lemma, dictionaryHeadword(other), other.display].some(v => collisionKey(v) === collisionKey(value))) {
        throw new Error(`Headword collision with ${other.lemma}`);
      }
    }
    metadata.headword = { ...decision.headword, value };
    display = value;
    forms = [...new Set([...record.forms, value])];
  }
  return VocabularyRecordSchema.parse({
    ...record, display, forms, editorial: metadata,
    ...(metadata.scope?.status === "archived" ? { publicationStatus: "hidden" } : {}),
  });
}
