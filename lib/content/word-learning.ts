import type { WordDetail } from "./word-detail";
import type { WikiConnection, WikiPage } from "../wiki/parse-wiki";

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

export type LearningConnection = WikiConnection & {
  explained: boolean;
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
  usageNote: string | null;
  connections: LearningConnection[];
  canClaim: boolean;
  claimBlockReason: string | null;
};

const FACTUAL_SOURCES = new Set(["curated", "wordnet", "dictionaryapi", "tatoeba"]);

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

export function buildWordLearningProfile(
  page: WikiPage,
  detail: WordDetail | null,
): WordLearningProfile {
  const factualWikiSource = page.sources.some((source) => FACTUAL_SOURCES.has(source));
  const advancedWithoutFactualSource = page.tier === "advanced" && !factualWikiSource;
  const usableWikiDefinition = Boolean(page.definition.trim()) && !isPlaceholder(page.definition);
  const verifiedWikiDefinition =
    !advancedWithoutFactualSource && page.status === "verified" && usableWikiDefinition;
  const sourceBackedWikiDefinition = factualWikiSource && usableWikiDefinition;

  const dictionarySenses = (detail?.senses ?? []).filter(
    (sense) => Boolean(normalizeText(sense.definition)) && !isPlaceholder(sense.definition),
  );
  const hasDictionaryDefinition = dictionarySenses.some((sense) => Boolean(normalizeText(sense.definition)));
  const preferDictionaryPrimary = advancedWithoutFactualSource && hasDictionaryDefinition;

  const evidence: LearningEvidence = verifiedWikiDefinition
    ? "verified"
    : sourceBackedWikiDefinition || (preferDictionaryPrimary && hasDictionaryDefinition)
      ? "source-backed"
      : "ai-draft";

  const senses: LearningSense[] = [];
  const seenDefinitions = new Set<string>();
  if (!preferDictionaryPrimary && page.definition.trim()) {
    addSense(senses, seenDefinitions, {
      source: "wiki",
      sourceIndex: 0,
      partOfSpeech: page.pos,
      definition: page.definition,
      example: page.examples[0] ?? null,
    });
  }
  dictionarySenses.forEach((sense, index) => {
    addSense(senses, seenDefinitions, {
      source: "dictionaryapi",
      sourceIndex: index,
      partOfSpeech: sense.partOfSpeech || page.pos,
      definition: sense.definition,
      example: sense.example,
    });
  });
  if (senses[0]) senses[0].primary = true;

  const examples: LearningExample[] = [];
  const seenExamples = new Set<string>();
  page.examples.forEach((text) => addExample(examples, seenExamples, { text, source: "wiki" }));
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
    lemma: page.lemma,
    display: page.display,
    tier: page.tier,
    partOfSpeech: page.pos,
    forms: page.forms,
    status: page.status,
    sources: page.sources,
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
    usageNote: page.usageNote,
    connections: page.connections.map((connection) => ({
      ...connection,
      explained: Boolean(connection.gloss?.trim()),
    })),
    canClaim,
    claimBlockReason,
  };
}
