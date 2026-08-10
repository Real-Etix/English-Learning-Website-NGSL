import { GalaxyAssetError, fetchVersionedJson } from "./asset-client";

import { normalizeGalaxySearch } from "../../../lib/galaxy/normalize-search";
import { isSearchCatalogData, type GalaxyManifest, type SearchCatalogData, type SearchEntry } from "../../../lib/galaxy/types";

type SearchCatalogOptions = { fetcher?: typeof fetch };

function compareEntries(a: SearchEntry, b: SearchEntry): number {
  return a.normalized < b.normalized ? -1 : a.normalized > b.normalized ? 1 : a.lemma < b.lemma ? -1 : a.lemma > b.lemma ? 1 : 0;
}

function levenshteinAtMostOne(a: string, b: string): boolean {
  if (Math.abs(a.length - b.length) > 1) return false;
  let aIndex = 0;
  let bIndex = 0;
  let edits = 0;
  while (aIndex < a.length && bIndex < b.length) {
    if (a[aIndex] === b[bIndex]) {
      aIndex += 1;
      bIndex += 1;
      continue;
    }
    if (edits === 1) return false;
    edits += 1;
    if (a[aIndex] === b[bIndex + 1] && a[aIndex + 1] === b[bIndex]) {
      aIndex += 2;
      bIndex += 2;
    } else if (a.length > b.length) aIndex += 1;
    else if (b.length > a.length) bIndex += 1;
    else {
      aIndex += 1;
      bIndex += 1;
    }
  }
  return true;
}

export class GalaxySearchCatalog {
  private data: SearchCatalogData | null = null;
  private loadPromise: Promise<SearchEntry[]> | null = null;
  private byLemma = new Map<string, SearchEntry>();

  constructor(private readonly manifest: GalaxyManifest | null, private readonly options: SearchCatalogOptions = {}) {}

  static fromData(data: SearchCatalogData): GalaxySearchCatalog {
    const catalog = new GalaxySearchCatalog(null);
    catalog.setData(data);
    catalog.loadPromise = Promise.resolve(catalog.entries());
    return catalog;
  }

  load(): Promise<SearchEntry[]> {
    if (this.loadPromise) return this.loadPromise;
    if (!this.manifest) return Promise.resolve([]);
    this.loadPromise = fetchVersionedJson(
      this.manifest.assets.searchIndex.url,
      this.manifest.version,
      new AbortController().signal,
      isSearchCatalogData,
      this.options.fetcher,
    ).then((data) => {
      if (data.listSlug !== this.manifest?.list.slug) throw new GalaxyAssetError("decode", "Invalid galaxy asset");
      this.setData(data);
      return this.entries();
    }).catch((error: unknown) => {
      this.loadPromise = null;
      throw error;
    });
    return this.loadPromise;
  }

  find(query: string, limit = 7): SearchEntry[] {
    if (!this.data || limit <= 0) return [];
    const normalized = normalizeGalaxySearch(query);
    if (!normalized) return [];
    const matches = this.data.entries.map((entry) => ({ entry, rank: this.rank(entry.normalized, normalized) }))
      .filter((match): match is { entry: SearchEntry; rank: number } => match.rank !== null)
      .sort((a, b) => a.rank - b.rank || compareEntries(a.entry, b.entry));
    return matches.slice(0, limit).map((match) => match.entry);
  }

  get(lemma: string): SearchEntry | null {
    return this.byLemma.get(lemma) ?? null;
  }

  entries(): SearchEntry[] {
    return this.data ? [...this.data.entries] : [];
  }

  private setData(data: SearchCatalogData): void {
    this.data = { ...data, entries: [...data.entries].sort(compareEntries) };
    this.byLemma = new Map(this.data.entries.map((entry) => [entry.lemma, entry]));
  }

  private rank(entry: string, query: string): number | null {
    if (entry === query) return 0;
    if (entry.startsWith(query)) return 1;
    if (entry.includes(query)) return 2;
    if (query.length >= 4 && levenshteinAtMostOne(entry, query)) return 3;
    return null;
  }
}
