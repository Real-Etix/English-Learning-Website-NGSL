import { createHash } from "node:crypto";

import type { WordDetail } from "../../content/word-detail";
import type { FactualDictionaryEvidence, SourcedExampleEvidence } from "./provider-types";

const REQUEST_TIMEOUT_MS = 15_000;
const MAX_ATTEMPTS = 2;

type ProviderId = "dictionaryapi" | "tatoeba";
export type ProviderFailureKind = "http" | "network" | "timeout" | "invalid_response";

export class ProviderFetchError extends Error {
  readonly name = "ProviderFetchError";

  constructor(
    readonly provider: ProviderId,
    readonly kind: ProviderFailureKind,
    readonly status?: number,
  ) {
    super(providerFailureMessage(provider, kind, status));
  }
}

export type HttpProviderOptions = {
  fetch?: typeof fetch;
  now?: () => Date;
};

type DictionaryDefinition = {
  definition?: unknown;
  example?: unknown;
  synonyms?: unknown;
};

type DictionaryMeaning = {
  partOfSpeech?: unknown;
  synonyms?: unknown;
  definitions?: unknown;
};

type DictionaryPhonetic = {
  text?: unknown;
  audio?: unknown;
};

type DictionaryEntry = {
  word?: unknown;
  sourceUrls?: unknown;
  phonetic?: unknown;
  phonetics?: unknown;
  meanings?: unknown;
};

type TatoebaSentence = {
  id?: unknown;
  text?: unknown;
  lang?: unknown;
};

function providerFailureMessage(provider: ProviderId, kind: ProviderFailureKind, status?: number): string {
  if (kind === "timeout") return `${provider} request timed out`;
  if (kind === "network") return `${provider} request failed`;
  if (kind === "invalid_response") return `${provider} returned an invalid response`;
  return `${provider} request failed with HTTP ${status}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringValues(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function arrayValues(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function firstString(value: unknown): string | null {
  return typeof value === "string" && value ? value : null;
}

function normalizedPartOfSpeech(value: string): string {
  return value.trim().toLowerCase();
}

function normalizedLemma(value: string): string {
  return value.replace(/_/g, " ").replace(/\s+/g, " ").trim();
}

function hashNormalized(value: unknown): string {
  return `sha256:${createHash("sha256").update(JSON.stringify(value), "utf8").digest("hex")}`;
}

function timeoutError(error: unknown): boolean {
  return isRecord(error) && (error.name === "TimeoutError" || error.name === "AbortError");
}

function retryableStatus(status: number): boolean {
  return status === 429 || status >= 500;
}

async function fetchResponse(
  provider: ProviderId,
  url: string,
  fetchImplementation: typeof fetch,
): Promise<Response> {
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    try {
      const response = await fetchImplementation(url, {
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      if (response.ok || response.status === 404) return response;
      if (retryableStatus(response.status) && attempt < MAX_ATTEMPTS) continue;
      throw new ProviderFetchError(provider, "http", response.status);
    } catch (error) {
      if (error instanceof ProviderFetchError) throw error;
      const kind: ProviderFailureKind = timeoutError(error) ? "timeout" : "network";
      if (attempt < MAX_ATTEMPTS) continue;
      throw new ProviderFetchError(provider, kind);
    }
  }

  throw new ProviderFetchError(provider, "network");
}

async function responseJson(provider: ProviderId, response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    throw new ProviderFetchError(provider, "invalid_response");
  }
}

function providerOptions(options: HttpProviderOptions): Required<HttpProviderOptions> {
  return {
    fetch: options.fetch ?? globalThis.fetch,
    now: options.now ?? (() => new Date()),
  };
}

function entrySourceUrl(entry: DictionaryEntry): string | null {
  return stringValues(entry.sourceUrls).find(Boolean) ?? null;
}

function pronunciationSource(entry: DictionaryEntry): { entryId?: string; url?: string | null } | undefined {
  const entryId = firstString(entry.word);
  const url = entrySourceUrl(entry);
  return entryId || url ? { ...(entryId ? { entryId } : {}), url } : undefined;
}

function firstPhonetic(
  entries: DictionaryEntry[],
  select: (phonetic: DictionaryPhonetic) => string | null,
): { value: string; entry: DictionaryEntry } | null {
  for (const entry of entries) {
    for (const phonetic of arrayValues(entry.phonetics)) {
      if (!isRecord(phonetic)) continue;
      const value = select(phonetic);
      if (value) return { value, entry };
    }
  }
  return null;
}

function completeCandidateToken(text: string, candidate: string): boolean {
  if (!candidate) return false;
  const escaped = candidate.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(?<![\\p{L}\\p{N}_])${escaped}(?![\\p{L}\\p{N}_])`, "iu").test(text);
}

export async function fetchDictionaryEvidence(
  lemma: string,
  partOfSpeech: string,
  options: HttpProviderOptions = {},
): Promise<FactualDictionaryEvidence | null> {
  const requestUrl = `https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(lemma)}`;
  const { fetch: fetchImplementation, now } = providerOptions(options);
  const response = await fetchResponse("dictionaryapi", requestUrl, fetchImplementation);
  if (response.status === 404) return null;

  const payload = await responseJson("dictionaryapi", response);
  if (!Array.isArray(payload)) throw new ProviderFetchError("dictionaryapi", "invalid_response");

  const exactPartOfSpeech = normalizedPartOfSpeech(partOfSpeech);
  const matchingEntries: DictionaryEntry[] = [];
  const senses: WordDetail["senses"] = [];
  const synonyms: string[] = [];
  for (const item of payload) {
    if (!isRecord(item)) continue;
    const entry = item as DictionaryEntry;
    const entryId = firstString(entry.word);
    const sourceUrl = entrySourceUrl(entry);
    const entrySenses: WordDetail["senses"] = [];

    for (const meaning of arrayValues(entry.meanings)) {
      if (!isRecord(meaning)) continue;
      const dictionaryMeaning = meaning as DictionaryMeaning;
      const meaningPartOfSpeech = firstString(dictionaryMeaning.partOfSpeech);
      if (!meaningPartOfSpeech || normalizedPartOfSpeech(meaningPartOfSpeech) !== exactPartOfSpeech) continue;

      synonyms.push(...stringValues(dictionaryMeaning.synonyms));
      for (const definition of arrayValues(dictionaryMeaning.definitions)) {
        if (!isRecord(definition)) continue;
        const dictionaryDefinition = definition as DictionaryDefinition;
        const text = firstString(dictionaryDefinition.definition);
        if (!text) continue;
        synonyms.push(...stringValues(dictionaryDefinition.synonyms));
        entrySenses.push({
          partOfSpeech: meaningPartOfSpeech,
          definition: text,
          example: firstString(dictionaryDefinition.example),
          ...(entryId ? { sourceEntryId: entryId } : {}),
          ...(sourceUrl ? { sourceUrl } : {}),
        });
      }
    }

    if (entrySenses.length > 0) {
      matchingEntries.push(entry);
      senses.push(...entrySenses);
    }
  }
  if (senses.length === 0 || matchingEntries.length === 0) return null;

  const ipaFromEntry = matchingEntries.find((entry) => firstString(entry.phonetic));
  const ipa = ipaFromEntry && firstString(ipaFromEntry.phonetic)
    ? { value: firstString(ipaFromEntry.phonetic)!, entry: ipaFromEntry }
    : firstPhonetic(matchingEntries, (phonetic) => firstString(phonetic.text));
  const audioFor = (region: string) => firstPhonetic(matchingEntries, (phonetic) => {
    const audio = firstString(phonetic.audio);
    return audio?.includes(`-${region}.`) ? audio : null;
  });
  const audioUk = audioFor("uk");
  const audioUs = audioFor("us");
  const audioAny = firstPhonetic(matchingEntries, (phonetic) => firstString(phonetic.audio));
  const soleEntry = matchingEntries.length === 1 ? matchingEntries[0]! : null;
  const detail: WordDetail = {
    ipa: ipa?.value ?? null,
    audioUk: audioUk?.value ?? null,
    audioUs: audioUs?.value ?? null,
    audioAny: audioAny?.value ?? null,
    ...(soleEntry && firstString(soleEntry.word) ? { sourceEntryId: firstString(soleEntry.word)! } : {}),
    ...(soleEntry && entrySourceUrl(soleEntry) ? { sourceUrl: entrySourceUrl(soleEntry) } : {}),
    pronunciationSources: {
      ...(ipa ? { ipa: pronunciationSource(ipa.entry) } : {}),
      ...(audioUk ? { audioUk: pronunciationSource(audioUk.entry) } : {}),
      ...(audioUs ? { audioUs: pronunciationSource(audioUs.entry) } : {}),
      ...(audioAny ? { audioAny: pronunciationSource(audioAny.entry) } : {}),
    },
    senses,
    synonyms: Array.from(new Set(synonyms)),
  };
  const returnedLemma = firstString(matchingEntries[0]!.word) ?? lemma;

  return {
    provider: "dictionaryapi",
    returnedLemma,
    requestedPartOfSpeech: partOfSpeech,
    detail,
    source: {
      sourceId: "dictionaryapi",
      url: requestUrl,
      retrievedAt: now().toISOString(),
      contentHash: hashNormalized({ returnedLemma, requestedPartOfSpeech: partOfSpeech, detail }),
    },
  };
}

export async function fetchTatoebaExamples(
  lemma: string,
  forms: string[],
  options: HttpProviderOptions = {},
): Promise<SourcedExampleEvidence[]> {
  const requestUrl = `https://api.tatoeba.org/v1/sentences?lang=${encodeURIComponent("eng")}&q=${encodeURIComponent(lemma)}&sort=relevance`;
  const { fetch: fetchImplementation, now } = providerOptions(options);
  const response = await fetchResponse("tatoeba", requestUrl, fetchImplementation);
  if (response.status === 404) return [];

  const payload = await responseJson("tatoeba", response);
  if (!isRecord(payload) || !Array.isArray(payload.data)) {
    throw new ProviderFetchError("tatoeba", "invalid_response");
  }

  const candidates = Array.from(new Set([lemma, ...forms].map(normalizedLemma).filter(Boolean)));
  const seenIds = new Set<string>();
  const retrievedAt = now().toISOString();
  const examples: SourcedExampleEvidence[] = [];
  for (const item of payload.data) {
    if (!isRecord(item)) continue;
    const sentence = item as TatoebaSentence;
    const text = sentence.text;
    if (!Number.isInteger(sentence.id) || typeof text !== "string" || sentence.lang !== "eng") continue;
    const externalId = String(sentence.id);
    if (!text.trim() || seenIds.has(externalId)) continue;
    if (!candidates.some((candidate) => completeCandidateToken(text, candidate))) continue;
    seenIds.add(externalId);

    examples.push({
      id: `tatoeba:${externalId}`,
      text,
      language: "eng",
      source: {
        sourceId: "tatoeba",
        externalId,
        url: `https://tatoeba.org/en/sentences/show/${externalId}`,
        retrievedAt,
        contentHash: hashNormalized({ id: externalId, text, language: "eng" }),
      },
    });
  }
  return examples;
}
