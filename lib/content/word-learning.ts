import type { WordDetail } from "./word-detail";
import { isLearnerConnection } from "../vocabulary/publication";
import type { CollocationPhrase, CommonMistake, ContentSourceRef, UsagePattern, VocabularyRecord } from "../vocabulary/schema";
import { evidenceForSources, sourceEntryFor } from "../vocabulary/source-evidence";

export type LearningEvidence = "verified" | "source-backed" | "ai-draft";

export type LearningSense = {
  id: string;
  partOfSpeech: string;
  definition: string;
  example: string | null;
  source: "wiki" | "dictionaryapi";
  primary: boolean;
};

export type LearningExample = {
  text: string;
  source: "wiki" | "dictionaryapi";
};

export type LearningConnection = {
  type: string;
  target: string;
  gloss?: string | null;
  explained: boolean;
};

/** A canonical source reference paired with its learner-readable registry label. */
export type LearningSource = ContentSourceRef & {
  label: string;
};

export type LearningPatternExample = {
  text: string;
  sources: LearningSource[];
};

export type LearningUsagePattern = {
  pattern: string;
  explanation: string;
  examples: LearningPatternExample[];
  sources: LearningSource[];
};

export type LearningCollocation = {
  phrase: string;
  explanation: string | null;
  sources: LearningSource[];
};

export type LearningCommonMistake = {
  incorrect: string;
  correction: string;
  explanation: string;
  sources: LearningSource[];
};

export type WordLearningProfile = {
  lemma: string;
  display: string;
  tier: "core" | "advanced";
  partOfSpeech: string;
  forms: string[];
  status: string;
  sources: string[];
  evidence: LearningEvidence;
  evidenceLabel: string;
  pronunciation: {
    ipa: string | null;
    audioUk: string | null;
    audioUs: string | null;
    audioAny: string | null;
  };
  senses: LearningSense[];
  examples: LearningExample[];
  usagePatterns: LearningUsagePattern[];
  collocations: LearningCollocation[];
  commonMistakes: LearningCommonMistake[];
  usageNote: string | null;
  connections: LearningConnection[];
  canClaim: boolean;
  claimBlockReason: string | null;
};

const normalizeText = (value: string) => value.trim().toLowerCase().replace(/\s+/g, " ");

const isPlaceholder = (value: string) =>
  /definition pending|needs a fuller dictionary source/i.test(value);

function addSense(
  senses: LearningSense[],
  seenDefinitions: Set<string>,
  sense: Omit<LearningSense, "id" | "primary"> & { sourceIndex: number },
) {
  const normalizedDefinition = normalizeText(sense.definition);
  if (!normalizedDefinition || seenDefinitions.has(normalizedDefinition) || senses.length >= 6) return;
  seenDefinitions.add(normalizedDefinition);
  senses.push({
    id: `${sense.source}:${sense.sourceIndex}`,
    partOfSpeech: sense.partOfSpeech,
    definition: sense.definition,
    example: sense.example,
    source: sense.source,
    primary: false,
  });
}

function addExample(examples: LearningExample[], seenExamples: Set<string>, example: LearningExample) {
  const normalizedExample = normalizeText(example.text);
  if (!normalizedExample || seenExamples.has(normalizedExample)) return;
  seenExamples.add(normalizedExample);
  examples.push(example);
}

function labelSources(sources: readonly ContentSourceRef[]): LearningSource[] {
  return sources.map((source) => ({ ...source, label: sourceEntryFor(source.sourceId).label }));
}

function isPublishedSourcedGuidance<T extends { status: string; sources: readonly ContentSourceRef[] }>(item: T): boolean {
  return item.status === "published" && item.sources.length > 0;
}

function learningPattern(pattern: UsagePattern): LearningUsagePattern {
  return {
    pattern: pattern.pattern,
    explanation: pattern.explanation,
    examples: pattern.examples.map((example) => ({ text: example.text, sources: labelSources(example.sources) })),
    sources: labelSources(pattern.sources),
  };
}

function learningCollocation(collocation: CollocationPhrase): LearningCollocation {
  return {
    phrase: collocation.phrase,
    explanation: collocation.explanation,
    sources: labelSources(collocation.sources),
  };
}

function learningCommonMistake(mistake: CommonMistake): LearningCommonMistake {
  return {
    incorrect: mistake.incorrect,
    correction: mistake.correction,
    explanation: mistake.explanation,
    sources: labelSources(mistake.sources),
  };
}

export function buildWordLearningProfile(
  record: VocabularyRecord,
  detail: WordDetail | null,
): WordLearningProfile {
  const primarySense = record.senses[0];
  const primaryDefinition = primarySense?.definition ?? "";
  const primaryExamples = primarySense?.examples ?? [];
  const selectedPublishedSense = primarySense?.status === "published" ? primarySense : null;
  const sourceIds = record.sources.map((source) => source.sourceId);
  const wikiEvidence = evidenceForSources(primarySense?.sources ?? [], { verified: record.status === "verified" });
  const factualWikiSource = wikiEvidence !== "ai-draft";
  const advancedWithoutFactualSource = record.tier === "advanced" && !factualWikiSource;
  const usableWikiDefinition = Boolean(primaryDefinition.trim()) && !isPlaceholder(primaryDefinition);
  const verifiedWikiDefinition = !advancedWithoutFactualSource && wikiEvidence === "verified" && usableWikiDefinition;
  const sourceBackedWikiDefinition = factualWikiSource && usableWikiDefinition;

  const dictionarySenses = (detail?.senses ?? []).filter(
    (sense) => Boolean(normalizeText(sense.definition)) && !isPlaceholder(sense.definition),
  );
  const hasDictionaryDefinition = dictionarySenses.some((sense) => Boolean(normalizeText(sense.definition)));
  const wikiDefinitionHasPrecedence = verifiedWikiDefinition || sourceBackedWikiDefinition;
  const preferDictionaryPrimary = !wikiDefinitionHasPrecedence && hasDictionaryDefinition;

  const evidence: LearningEvidence = verifiedWikiDefinition
    ? "verified"
    : sourceBackedWikiDefinition || (preferDictionaryPrimary && hasDictionaryDefinition)
      ? "source-backed"
      : "ai-draft";

  const senses: LearningSense[] = [];
  const seenDefinitions = new Set<string>();
  if (!preferDictionaryPrimary && usableWikiDefinition) {
    addSense(senses, seenDefinitions, {
      source: "wiki",
      sourceIndex: 0,
      partOfSpeech: primarySense?.partOfSpeech ?? record.partOfSpeech,
      definition: primaryDefinition,
      example: primaryExamples[0]?.text ?? null,
    });
  }
  dictionarySenses.forEach((sense, index) => {
    addSense(senses, seenDefinitions, {
      source: "dictionaryapi",
      sourceIndex: index,
      partOfSpeech: sense.partOfSpeech || record.partOfSpeech,
      definition: sense.definition,
      example: sense.example,
    });
  });
  if (senses[0]) senses[0].primary = true;

  const examples: LearningExample[] = [];
  const seenExamples = new Set<string>();
  primaryExamples.forEach(({ text }) => addExample(examples, seenExamples, { text, source: "wiki" }));
  dictionarySenses.forEach((sense) => {
    if (sense.example) addExample(examples, seenExamples, { text: sense.example, source: "dictionaryapi" });
  });

  const canUseWikiExamplesForClaim = verifiedWikiDefinition || sourceBackedWikiDefinition;
  const hasSourcedExample = examples.some(
    (example) => example.source === "dictionaryapi" || canUseWikiExamplesForClaim,
  );
  const canClaim = evidence !== "ai-draft" && hasSourcedExample;
  const claimBlockReason = canClaim
    ? null
    : evidence === "ai-draft"
      ? "This word needs a trustworthy meaning before it can be claimed."
      : "This word needs a sourced example before it can be claimed.";

  return {
    lemma: record.lemma,
    display: record.display,
    tier: record.tier,
    partOfSpeech: primarySense?.partOfSpeech ?? record.partOfSpeech,
    forms: record.forms,
    status: record.status,
    sources: sourceIds,
    evidence,
    evidenceLabel:
      evidence === "verified" ? "Verified" : evidence === "source-backed" ? "Source-backed" : "AI draft",
    pronunciation: {
      ipa: detail?.ipa ?? null,
      audioUk: detail?.audioUk ?? null,
      audioUs: detail?.audioUs ?? null,
      audioAny: detail?.audioAny ?? null,
    },
    senses,
    examples,
    usagePatterns: selectedPublishedSense?.usagePatterns
      .filter(isPublishedSourcedGuidance)
      .map(learningPattern) ?? [],
    collocations: selectedPublishedSense?.collocations
      .filter(isPublishedSourcedGuidance)
      .map(learningCollocation) ?? [],
    commonMistakes: selectedPublishedSense?.commonMistakes
      .filter(isPublishedSourcedGuidance)
      .map(learningCommonMistake) ?? [],
    usageNote: record.usageNote,
    connections: record.connections.filter(isLearnerConnection).map((connection) => ({
      ...connection,
      explained: Boolean(connection.gloss?.trim()),
    })),
    canClaim,
    claimBlockReason,
  };
}
