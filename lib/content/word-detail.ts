/**
 * Live dictionary detail for the Cambridge-style word card.
 * Pulls IPA, UK/US audio, and extra senses from the Free Dictionary API.
 * Best-effort: any failure returns nulls so the card still renders wiki data.
 */
export interface DictionarySense {
  partOfSpeech: string;
  definition: string;
  example: string | null;
  sourceEntryId?: string;
  sourceSenseId?: string;
  sourceUrl?: string | null;
}

export interface DictionarySourceMetadata {
  entryId?: string;
  url?: string | null;
}

export interface WordDetail {
  ipa: string | null;
  audioUk: string | null;
  audioUs: string | null;
  audioAny: string | null;
  sourceEntryId?: string;
  sourceUrl?: string | null;
  pronunciationSources?: {
    ipa?: DictionarySourceMetadata;
    audioUk?: DictionarySourceMetadata;
    audioUs?: DictionarySourceMetadata;
    audioAny?: DictionarySourceMetadata;
  };
  senses: DictionarySense[];
  synonyms: string[];
}

type ApiEntry = {
  word?: string;
  sourceUrls?: string[];
  phonetic?: string;
  phonetics?: Array<{ text?: string; audio?: string }>;
  meanings?: Array<{
    partOfSpeech?: string;
    synonyms?: string[];
    definitions?: Array<{ definition?: string; example?: string }>;
  }>;
};

const EMPTY: WordDetail = {
  ipa: null,
  audioUk: null,
  audioUs: null,
  audioAny: null,
  senses: [],
  synonyms: [],
};

export async function fetchWordDetail(word: string): Promise<WordDetail> {
  try {
    const res = await fetch(
      `https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(word)}`,
      { next: { revalidate: 86400 } },
    );
    if (!res.ok) return EMPTY;
    const data = (await res.json()) as ApiEntry[];

    const phonetics = data.flatMap((e) => e.phonetics ?? []);
    const sourceEntry = data.find((entry) => entry.word)?.word;
    const sourceUrl = data.flatMap((entry) => entry.sourceUrls ?? []).find(Boolean) ?? null;
    const sourceMetadata = sourceEntry ? { entryId: sourceEntry, url: sourceUrl } : undefined;
    const ipa =
      data.find((e) => e.phonetic)?.phonetic ??
      phonetics.find((p) => p.text)?.text ??
      null;

    const audioFor = (region: string) =>
      phonetics.find((p) => p.audio && p.audio.includes(`-${region}.`))?.audio ?? null;
    const audioAny = phonetics.find((p) => p.audio)?.audio ?? null;

    const senses: DictionarySense[] = [];
    for (const entry of data) {
      for (const meaning of entry.meanings ?? []) {
        for (const def of meaning.definitions ?? []) {
          if (!def.definition) continue;
          senses.push({
            partOfSpeech: meaning.partOfSpeech ?? "",
            definition: def.definition,
            example: def.example ?? null,
            ...(sourceEntry ? { sourceEntryId: sourceEntry, sourceUrl } : {}),
          });
        }
      }
    }

    const synonyms = Array.from(
      new Set(data.flatMap((e) => e.meanings ?? []).flatMap((m) => m.synonyms ?? [])),
    ).slice(0, 8);

    return {
      ipa,
      audioUk: audioFor("uk"),
      audioUs: audioFor("us"),
      audioAny,
      ...(sourceEntry ? { sourceEntryId: sourceEntry, sourceUrl } : {}),
      pronunciationSources: {
        ...(ipa ? { ipa: sourceMetadata } : {}),
        ...(audioFor("uk") ? { audioUk: sourceMetadata } : {}),
        ...(audioFor("us") ? { audioUs: sourceMetadata } : {}),
        ...(audioAny ? { audioAny: sourceMetadata } : {}),
      },
      senses: senses.slice(0, 6),
      synonyms,
    };
  } catch {
    return EMPTY;
  }
}
