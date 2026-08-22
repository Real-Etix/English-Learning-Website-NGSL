import type { VocabularyRecord } from "./schema";

export interface VocabularyRepository {
  get(lemma: string): Promise<VocabularyRecord | undefined>;
  all(): AsyncIterable<VocabularyRecord>;
  list(listId: string): AsyncIterable<VocabularyRecord>;
}
