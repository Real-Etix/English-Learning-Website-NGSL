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

type EntryProvenance = {
  entryId?: string;
  url?: string | null;
};

type PhoneticMatch = {
  value: string;
  entry: ApiEntry;
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

    const entryProvenance = (entry: ApiEntry): EntryProvenance => ({
      ...(entry.word ? { entryId: entry.word } : {}),
      url: entry.sourceUrls?.find(Boolean) ?? null,
    });
    const sourceMetadataFor = (entry: ApiEntry): DictionarySourceMetadata | undefined => {
      const provenance = entryProvenance(entry);
      return provenance.entryId || provenance.url ? provenance : undefined;
    };
    const phoneticMatch = (
      select: (phonetic: { text?: string; audio?: string }) => string | undefined,
    ): PhoneticMatch | null => {
      for (const entry of data) {
        for (const phonetic of entry.phonetics ?? []) {
          const value = select(phonetic);
          if (value) return { value, entry };
        }
      }
      return null;
    };
    const phoneticEntry = data.find((entry) => entry.phonetic);
    const ipaEntry = phoneticEntry?.phonetic
      ? { value: phoneticEntry.phonetic, entry: phoneticEntry }
      : phoneticMatch((phonetic) => phonetic.text);
    const audioFor = (region: string) => phoneticMatch((phonetic) =>
      phonetic.audio?.includes(`-${region}.`) ? phonetic.audio : undefined,
    );
    const audioUk = audioFor("uk");
    const audioUs = audioFor("us");
    const audioAny = phoneticMatch((phonetic) => phonetic.audio);

    const senses: DictionarySense[] = [];
    for (const entry of data) {
      const provenance = entryProvenance(entry);
      for (const meaning of entry.meanings ?? []) {
        for (const def of meaning.definitions ?? []) {
          if (!def.definition) continue;
          senses.push({
            partOfSpeech: meaning.partOfSpeech ?? "",
            definition: def.definition,
            example: def.example ?? null,
            ...(provenance.entryId ? { sourceEntryId: provenance.entryId } : {}),
            ...(provenance.url ? { sourceUrl: provenance.url } : {}),
          });
        }
      }
    }

    const synonyms = Array.from(
      new Set(data.flatMap((e) => e.meanings ?? []).flatMap((m) => m.synonyms ?? [])),
    ).slice(0, 8);

    return {
      ipa: ipaEntry?.value ?? null,
      audioUk: audioUk?.value ?? null,
      audioUs: audioUs?.value ?? null,
      audioAny: audioAny?.value ?? null,
      ...(data.length === 1 && data[0]?.word ? { sourceEntryId: data[0].word } : {}),
      ...(data.length === 1 && data[0]?.sourceUrls?.find(Boolean)
        ? { sourceUrl: data[0].sourceUrls.find(Boolean) } : {}),
      pronunciationSources: {
        ...(ipaEntry ? { ipa: sourceMetadataFor(ipaEntry.entry) } : {}),
        ...(audioUk ? { audioUk: sourceMetadataFor(audioUk.entry) } : {}),
        ...(audioUs ? { audioUs: sourceMetadataFor(audioUs.entry) } : {}),
        ...(audioAny ? { audioAny: sourceMetadataFor(audioAny.entry) } : {}),
      },
      senses: senses.slice(0, 6),
      synonyms,
    };
  } catch {
    return EMPTY;
  }
}
