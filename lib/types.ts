export type LearningListSlug =
  | "ngsl"
  | "toeic"
  | "business"
  | "academic"
  | "fitness";

export type MoodSlug =
  | "focused"
  | "career"
  | "study"
  | "energized"
  | "curious";

export type PracticeMode =
  | "listen_type"
  | "meaning_match"
  | "study_card";

export type ContentStatus = "source_backed" | "manual_override" | "fallback";

export interface SourceCredit {
  id: string;
  label: string;
  url: string;
  license?: string;
}

export interface ImportedWord {
  lemma: string;
  normalizedLemma: string;
  rank: number | null;
  band: number | null;
  sfi: number | null;
  frequency: number | null;
  forms: string[];
}

export interface ExampleSentence {
  id: string;
  text: string;
  explanation: string;
  source: "curated" | "generated";
}

export interface ReferenceItem {
  id: string;
  lemma: string;
  title: string;
  platform: "video" | "blog" | "forum" | "social";
  url: string;
  excerpt: string;
  timestampLabel?: string;
  contextNote: string;
}

export interface WordEnrichment {
  definition: string;
  partOfSpeech: string;
  exampleSentences: ExampleSentence[];
  relatedPhrases: string[];
  phrasalVerbs: string[];
  conversationPrompt: string;
  sourceCredits: SourceCredit[];
  contentStatus: ContentStatus;
}

export interface LearningWord extends ImportedWord, WordEnrichment {
  listSlug: LearningListSlug;
}

export interface WordListMeta {
  slug: LearningListSlug;
  title: string;
  shortLabel: string;
  subtitle: string;
  description: string;
  moodHook: string;
  accentColor: string;
  sourcePageUrl: string;
  teachingUrl: string;
  statsUrl: string;
  license: string;
}

export interface WordListData extends WordListMeta {
  wordCount: number;
  words: LearningWord[];
}

export interface ImportedListData extends WordListMeta {
  wordCount: number;
  words: ImportedWord[];
}

export interface ImportedCatalog {
  generatedAt: string;
  lists: ImportedListData[];
}

export interface GeneratedEnrichmentLibrary {
  generatedAt: string;
  items: Record<string, WordEnrichment>;
}

export interface GeneratedReferenceLibrary {
  generatedAt: string;
  items: Record<string, ReferenceItem[]>;
}

export interface AiGenerationResult {
  title: string;
  sentences: string[];
  paragraph: string;
  conversation: string[];
  usageTip: string;
  fromModel: boolean;
}

export interface ProgressRecord {
  totalCorrect: number;
  totalAttempts: number;
  streakDays: number;
  learnedWords: Record<string, string[]>;
  recentActivity: Array<{
    lemma: string;
    listSlug: LearningListSlug;
    correct: boolean;
    practicedAt: string;
  }>;
  difficultWords: string[];
}
