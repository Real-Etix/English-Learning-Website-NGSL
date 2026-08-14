import type { FullGalaxyData } from "../../../lib/galaxy/full-codec";
import type { ChartShard, GalaxyManifest, PositionedWord } from "../../../lib/galaxy/types";

export type GalaxyView = "constellation" | "chart" | "full";

type LabelCandidateInput = {
  focus?: string | null;
  hover?: string | null;
  neighbors?: Set<string>;
  route?: Set<string>;
  claimed?: Set<string>;
  max: number;
};

function compareOrdinal(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function unpackFullWords(data: FullGalaxyData): PositionedWord[] {
  return data.words.map((word, index) => ({
    ...word,
    tier: data.tiers[index] === 0 ? "core" : "advanced",
    rank: data.ranks[index] < 0 ? null : data.ranks[index],
    degree: data.degrees[index],
    xyz: [data.positions[index * 3], data.positions[index * 3 + 1], data.positions[index * 3 + 2]],
  }));
}

export class GalaxySceneModel {
  readonly manifest: GalaxyManifest;

  private readonly charts = new Map<string, ChartShard>();
  private full: { data: FullGalaxyData; words: PositionedWord[] } | null = null;
  private selectedChart: string | null = null;

  constructor(manifest: GalaxyManifest) {
    this.manifest = manifest;
  }

  view(): GalaxyView {
    if (this.full) return "full";
    return this.selectedChart ? "chart" : "constellation";
  }

  setChart(chartId: string | null): void {
    this.selectedChart = chartId;
  }

  upsertChart(shard: ChartShard): void {
    this.charts.set(shard.chartId, shard);
  }

  removeChart(chartId: string): void {
    this.charts.delete(chartId);
  }

  enterFull(data: FullGalaxyData): void {
    this.full = { data, words: unpackFullWords(data) };
  }

  exitFull(): void {
    this.full = null;
  }

  getWord(lemma: string): PositionedWord | null {
    for (const word of this.activeWords()) {
      if (word.lemma === lemma) return word;
    }
    return null;
  }

  residentWords(): PositionedWord[] {
    return [...this.charts.values()].flatMap((shard) => shard.words);
  }

  residentEdges(): ChartShard["edges"] {
    return [...this.charts.values()].flatMap((shard) => shard.edges);
  }

  visibleWords(): PositionedWord[] {
    return this.activeWords();
  }

  wordCount(): number {
    return this.activeWords().length;
  }

  labelCandidates(input: LabelCandidateInput): PositionedWord[] {
    if (input.max <= 0) return [];
    const words = this.activeWords();
    const byLemma = new Map(words.map((word) => [word.lemma, word]));
    const selected: PositionedWord[] = [];
    const seen = new Set<string>();
    const append = (lemma: string | null | undefined) => {
      if (!lemma || seen.has(lemma)) return;
      const word = byLemma.get(lemma);
      if (!word) return;
      seen.add(lemma);
      selected.push(word);
    };

    append(input.focus);
    append(input.hover);
    input.neighbors?.forEach(append);
    input.route?.forEach(append);
    input.claimed?.forEach(append);
    words
      .slice()
      .sort((a, b) => b.degree - a.degree || compareOrdinal(a.lemma, b.lemma))
      .forEach((word) => append(word.lemma));

    return selected.slice(0, input.max);
  }

  private activeWords(): PositionedWord[] {
    return this.full?.words ?? this.residentWords();
  }
}
