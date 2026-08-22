import { createHash } from "node:crypto";

export function normalizeVocabularyLemma(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

export function shardIdForLemma(lemma: string): string {
  const normalized = normalizeVocabularyLemma(lemma);
  if (!normalized) throw new Error("Vocabulary lemma cannot be empty");
  const byte = createHash("sha256").update(normalized, "utf8").digest()[0];
  return (byte & 31).toString(16).padStart(2, "0");
}
