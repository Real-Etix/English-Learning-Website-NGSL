import { createHash } from "node:crypto";
import { parseLegacyMarkdownPage, type WikiPage } from "./legacy-markdown";
import { VocabularyRecordSchema, type ContentSourceRef, type VocabularyConnection, type VocabularyRecord } from "./schema";
import { normalizeVocabularyLemma } from "./shards";

const CONNECTION_TYPES = new Set<VocabularyConnection["type"]>([
  "synonym", "antonym", "intensity", "builds_on", "advanced_form", "morphological", "collocation",
]);

export type SourceRegistryEntry = {
  id: string;
  label: string;
  homepage: string | null;
  license: string | null;
  factual: boolean;
};

const KNOWN_SOURCES: Record<string, Omit<SourceRegistryEntry, "id">> = {
  curated: {
    label: "Manual curation",
    homepage: "https://www.newgeneralservicelist.com/new-general-service-list",
    license: "Project-authored content",
    factual: true,
  },
  dictionaryapi: {
    label: "Dictionary API",
    homepage: "https://dictionaryapi.dev/",
    license: "Free public API",
    factual: true,
  },
  tatoeba: {
    label: "Tatoeba",
    homepage: "https://tatoeba.org/",
    license: "CC BY 2.0 FR / CC0 1.0",
    factual: true,
  },
  wordnet: {
    label: "WordNet",
    homepage: "https://wordnet.princeton.edu/",
    license: "WordNet License",
    factual: true,
  },
  llm: { label: "LLM drafting pass", homepage: null, license: null, factual: false },
  generated: { label: "Generated sentence", homepage: null, license: null, factual: false },
};

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function uniqueSorted(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))].sort(compareText);
}

export function contentSourceRef(sourceId: string): ContentSourceRef {
  return { sourceId, externalId: null, url: null, retrievedAt: null, contentHash: null };
}

function sourceRefs(sourceIds: string[]): ContentSourceRef[] {
  return uniqueSorted(sourceIds).map(contentSourceRef);
}

function legacySenseId(page: WikiPage, sources: ContentSourceRef[]): string {
  const material = [page.lemma, page.pos, page.definition, ...sources.map((source) => source.sourceId)].join("\u0000");
  return `legacy-${createHash("sha256").update(material, "utf8").digest("hex").slice(0, 20)}`;
}

function legacyStatus(value: string): VocabularyRecord["status"] {
  return value === "verified" || value === "enriched" ? value : "seeded";
}

/** Builds registry entries for every source ID actually encountered during migration. */
export function sourceRegistry(sourceIds: Iterable<string>): SourceRegistryEntry[] {
  return uniqueSorted([...sourceIds]).map((id) => ({
    id,
    ...(KNOWN_SOURCES[id] ?? { label: id, homepage: null, license: null, factual: false }),
  }));
}

/** Converts one legacy page without creating content that did not exist in Markdown. */
export function convertLegacyMarkdown(markdown: string): VocabularyRecord | null {
  const page = parseLegacyMarkdownPage(markdown);
  if (!page) return null;
  const lemma = normalizeVocabularyLemma(page.lemma);
  if (!lemma || !page.definition) return null;
  const pageSources = sourceRefs(page.sources);
  const connections = page.connections
    .filter((connection): connection is WikiPage["connections"][number] & { type: VocabularyConnection["type"] } =>
      CONNECTION_TYPES.has(connection.type as VocabularyConnection["type"]),
    )
    .map((connection) => {
      const gloss = connection.gloss || null;
      return {
        target: normalizeVocabularyLemma(connection.target),
        type: connection.type,
        gloss,
        sources: pageSources,
        status: gloss ? "published" : "unreviewed",
      };
    })
    .filter((connection) => connection.target)
    .sort((left, right) => compareText(`${left.type}\u0000${left.target}\u0000${left.gloss ?? ""}`, `${right.type}\u0000${right.target}\u0000${right.gloss ?? ""}`));
  const record = {
    schemaVersion: 1,
    lemma,
    display: page.display,
    tier: page.tier,
    partOfSpeech: page.pos,
    forms: uniqueSorted(page.forms),
    lists: uniqueSorted(page.lists).map((id) => ({ id, rank: page.rank, sfi: page.sfi })),
    status: legacyStatus(page.status),
    publicationStatus: "published",
    sources: pageSources,
    senses: [{
      id: legacySenseId(page, pageSources),
      partOfSpeech: page.pos,
      definition: page.definition,
      labels: [],
      sources: pageSources,
      examples: page.examples.map((example) => ({
        text: example.text,
        sources: example.sourceIds.length ? sourceRefs(example.sourceIds) : pageSources,
      })),
      usagePatterns: [],
      collocations: [],
      commonMistakes: [],
      status: "published",
    }],
    pronunciation: [],
    usageNote: page.usageNote,
    connections,
    domains: uniqueSorted(page.domains),
    chart: page.chart,
    region: page.region,
  } as const;
  return VocabularyRecordSchema.parse(record);
}
