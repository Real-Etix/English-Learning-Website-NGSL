import type { WordDetail } from "../../content/word-detail";
import type { DictionaryImportSource } from "../enrichment/dictionary-import";
import type { ContentSourceRef } from "../schema";

export type FactualProviderId = "wordnet" | "dictionaryapi";

export type FactualDictionaryEvidence = {
  provider: FactualProviderId;
  returnedLemma: string;
  requestedPartOfSpeech: string;
  detail: WordDetail;
  source: DictionaryImportSource;
};

export type SourcedExampleEvidence = {
  id: string;
  text: string;
  language: "eng";
  source: ContentSourceRef;
};
