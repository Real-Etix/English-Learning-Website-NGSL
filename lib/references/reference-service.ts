import generatedReferences from "@/data/generated/references.json";
import type { GeneratedReferenceLibrary } from "@/lib/types";

export function getReferencesForLemma(lemma: string) {
  const normalized = lemma.toLowerCase();
  return ((generatedReferences as GeneratedReferenceLibrary).items[normalized] ?? []).slice(
    0,
    4,
  );
}
