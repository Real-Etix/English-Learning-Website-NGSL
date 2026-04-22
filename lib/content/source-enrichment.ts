import { defaultEnrichment } from "@/data/seed-enrichments";
import { dedupeSourceCredits, sourceCredits } from "@/lib/content/source-credits";
import type { ExampleSentence, LearningWord, WordEnrichment } from "@/lib/types";

const PARTICLES = new Set([
  "about",
  "across",
  "after",
  "along",
  "around",
  "aside",
  "at",
  "away",
  "back",
  "by",
  "down",
  "for",
  "forward",
  "from",
  "in",
  "into",
  "off",
  "on",
  "out",
  "over",
  "round",
  "through",
  "to",
  "together",
  "under",
  "up",
  "with",
]);

const WINDOW_STOPWORDS = new Set([
  "a",
  "an",
  "and",
  "are",
  "as",
  "at",
  "be",
  "for",
  "from",
  "has",
  "have",
  "in",
  "is",
  "it",
  "of",
  "on",
  "or",
  "that",
  "the",
  "their",
  "this",
  "to",
  "was",
  "with",
]);

type DictionaryEntry = {
  word?: string;
  meanings?: Array<{
    partOfSpeech?: string;
    definitions?: Array<{
      definition?: string;
      example?: string;
    }>;
  }>;
};

type TatoebaResponse = {
  data?: Array<{
    id: number;
    text: string;
    lang?: string;
  }>;
};

function normalizeWordToken(value: string) {
  return value.toLowerCase().replace(/[^a-z'-]/g, "");
}

function tokenizeSentence(sentence: string) {
  return sentence.match(/[A-Za-z][A-Za-z'-]*/g) ?? [];
}

function createExampleSentence(
  id: string,
  text: string,
  explanation: string,
): ExampleSentence {
  return {
    id,
    text,
    explanation,
    source: "curated",
  };
}

function dedupeExamples(examples: ExampleSentence[]) {
  return Array.from(
    new Map(examples.map((example) => [example.text.toLowerCase(), example])).values(),
  );
}

function rankPartOfSpeech(partOfSpeech: string | undefined) {
  const normalized = (partOfSpeech ?? "").toLowerCase();

  if (normalized.includes("verb")) {
    return 90;
  }
  if (normalized.includes("noun")) {
    return 80;
  }
  if (normalized.includes("adjective")) {
    return 70;
  }
  if (normalized.includes("adverb")) {
    return 60;
  }
  if (normalized.includes("preposition")) {
    return 50;
  }
  if (normalized.includes("determiner") || normalized.includes("article")) {
    return 35;
  }
  if (normalized.includes("pronoun")) {
    return 30;
  }
  if (normalized.includes("conjunction")) {
    return 25;
  }

  return 10;
}

function selectPrimaryMeaning(entry: DictionaryEntry) {
  const meanings = entry.meanings ?? [];

  const ranked = meanings
    .map((meaning) => {
      const definitions = meaning.definitions ?? [];
      const firstDefinition = definitions.find((item) => item.definition);
      if (!firstDefinition?.definition) {
        return null;
      }

      return {
        meaning,
        score:
          rankPartOfSpeech(meaning.partOfSpeech) +
          definitions.filter((item) => item.example).length * 5,
      };
    })
    .filter(Boolean)
    .sort((left, right) => right!.score - left!.score);

  return ranked[0]?.meaning ?? null;
}

function extractDefinition(entry: DictionaryEntry) {
  const selectedMeaning = selectPrimaryMeaning(entry);
  const definition = selectedMeaning?.definitions?.find((item) => item.definition);

  if (!selectedMeaning || !definition?.definition) {
    return null;
  }

  return {
    definition: definition.definition,
    partOfSpeech: selectedMeaning.partOfSpeech ?? "word",
  };
}

function extractDictionaryExamples(lemma: string, entry: DictionaryEntry) {
  const selectedMeaning = selectPrimaryMeaning(entry);
  const meanings = selectedMeaning
    ? [selectedMeaning, ...(entry.meanings ?? []).filter((item) => item !== selectedMeaning)]
    : (entry.meanings ?? []);

  const examples: ExampleSentence[] = [];

  for (const meaning of meanings) {
    for (const definition of meaning.definitions ?? []) {
      if (!definition.example) {
        continue;
      }

      examples.push(
        createExampleSentence(
          `${lemma}-dictionary-${examples.length + 1}`,
          definition.example,
          `Source-backed example from Dictionary API (${meaning.partOfSpeech ?? "word"}).`,
        ),
      );
    }
  }

  return dedupeExamples(examples).slice(0, 3);
}

function extractRelatedPhrases(lemma: string, forms: string[], examples: ExampleSentence[]) {
  const acceptedForms = new Set(
    [lemma, ...forms].map((item) => normalizeWordToken(item)).filter(Boolean),
  );
  const phrases: string[] = [];

  for (const example of examples) {
    const normalizedTokens = tokenizeSentence(example.text).map(normalizeWordToken);

    normalizedTokens.forEach((token, index) => {
      if (!acceptedForms.has(token)) {
        return;
      }

      const previous = normalizedTokens[index - 1];
      const next = normalizedTokens[index + 1];
      const nextTwo = normalizedTokens[index + 2];

      if (previous && !WINDOW_STOPWORDS.has(previous)) {
        phrases.push(`${previous} ${lemma}`);
      }
      if (next && !WINDOW_STOPWORDS.has(next)) {
        phrases.push(`${lemma} ${next}`);
      }
      if (next && nextTwo && !WINDOW_STOPWORDS.has(next) && !WINDOW_STOPWORDS.has(nextTwo)) {
        phrases.push(`${lemma} ${next} ${nextTwo}`);
      }
    });
  }

  return Array.from(
    new Set(
      phrases
        .map((phrase) => phrase.replace(/\s+/g, " ").trim())
        .filter((phrase) => phrase !== lemma && phrase.length > lemma.length + 1),
    ),
  ).slice(0, 4);
}

function extractPhrasalVerbs(
  lemma: string,
  forms: string[],
  examples: ExampleSentence[],
  partOfSpeech: string,
) {
  if (!partOfSpeech.toLowerCase().includes("verb")) {
    return [];
  }

  const acceptedForms = new Set(
    [lemma, ...forms].map((item) => normalizeWordToken(item)).filter(Boolean),
  );
  const phrasalVerbs: string[] = [];

  for (const example of examples) {
    const tokens = tokenizeSentence(example.text).map(normalizeWordToken);
    tokens.forEach((token, index) => {
      if (!acceptedForms.has(token)) {
        return;
      }

      const next = tokens[index + 1];
      if (next && PARTICLES.has(next)) {
        phrasalVerbs.push(`${lemma} ${next}`);
      }
    });
  }

  return Array.from(new Set(phrasalVerbs)).slice(0, 3);
}

function buildConversationPrompt(
  lemma: string,
  definition: string,
  examples: ExampleSentence[],
) {
  const anchoredExample = examples[0]?.text;
  if (anchoredExample) {
    return `Use "${lemma}" in a short conversation that sounds natural in the same kind of context as: ${anchoredExample}`;
  }

  return `Use "${lemma}" in a short conversation where it means: ${definition}`;
}

async function fetchJson<T>(url: string): Promise<T | null> {
  const response = await fetch(url, {
    headers: {
      Accept: "application/json",
      "User-Agent": "ngsl-mood-trainer/1.0",
    },
    next: {
      revalidate: 86400,
    },
  });

  if (!response.ok) {
    return null;
  }

  return (await response.json()) as T;
}

async function fetchDictionaryEntry(lemma: string) {
  return fetchJson<DictionaryEntry[]>(
    `https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(lemma)}`,
  );
}

async function fetchTatoebaExamples(lemma: string, forms: string[]) {
  const payload = await fetchJson<TatoebaResponse>(
    `https://api.tatoeba.org/v1/sentences?lang=eng&q=${encodeURIComponent(
      lemma,
    )}&sort=relevance&limit=5`,
  );

  const acceptedForms = new Set(
    [lemma, ...forms].map((item) => normalizeWordToken(item)).filter(Boolean),
  );

  const examples =
    payload?.data
      ?.filter((item) => item.lang === "eng")
      .filter((item) => {
        const tokens = tokenizeSentence(item.text).map(normalizeWordToken);
        return tokens.some((token) => acceptedForms.has(token));
      })
      .map((item, index) =>
        createExampleSentence(
          `${lemma}-tatoeba-${index + 1}`,
          item.text,
          "Source-backed example from Tatoeba.",
        ),
      ) ?? [];

  return dedupeExamples(examples).slice(0, 2);
}

export async function fetchSourceBackedEnrichment({
  lemma,
  forms,
}: {
  lemma: string;
  forms: string[];
}) {
  const entries = await fetchDictionaryEntry(lemma);

  if (!entries || entries.length === 0) {
    return defaultEnrichment(lemma);
  }

  const primaryEntry = entries[0];
  const extractedDefinition = extractDefinition(primaryEntry);

  if (!extractedDefinition) {
    return defaultEnrichment(lemma);
  }

  let examples = extractDictionaryExamples(lemma, primaryEntry);
  const credits = [sourceCredits.dictionaryApi];

  if (examples.length === 0) {
    const tatoebaExamples = await fetchTatoebaExamples(lemma, forms);
    if (tatoebaExamples.length > 0) {
      examples = dedupeExamples([...examples, ...tatoebaExamples]).slice(0, 3);
      credits.push(sourceCredits.tatoeba);
    }
  }

  return {
    definition: extractedDefinition.definition,
    partOfSpeech: extractedDefinition.partOfSpeech,
    exampleSentences: examples,
    relatedPhrases: extractRelatedPhrases(lemma, forms, examples),
    phrasalVerbs: extractPhrasalVerbs(
      lemma,
      forms,
      examples,
      extractedDefinition.partOfSpeech,
    ),
    conversationPrompt: buildConversationPrompt(
      lemma,
      extractedDefinition.definition,
      examples,
    ),
    sourceCredits: dedupeSourceCredits(credits),
    contentStatus: "source_backed" as const,
  } satisfies WordEnrichment;
}

export async function hydrateLearningWord(word: LearningWord) {
  if (word.contentStatus !== "fallback") {
    return word;
  }

  const hydratedEnrichment = await fetchSourceBackedEnrichment({
    lemma: word.lemma,
    forms: word.forms,
  });

  return {
    ...word,
    ...hydratedEnrichment,
  };
}

export async function hydrateLearningWords(words: LearningWord[]) {
  return Promise.all(words.map(hydrateLearningWord));
}
