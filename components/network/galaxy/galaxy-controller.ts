import type { ChartShardStore } from "./chart-shard-store";
import type { ProgressiveStarEngine } from "./progressive-engine";
import type { GalaxySearchCatalog } from "./search-catalog";

import type { ChartShard, GalaxyManifest, SearchEntry } from "../../../lib/galaxy/types";

export type GalaxyControllerStatus = {
  chartId: string | null;
  chartLoad: "idle" | "loading" | "ready" | "error";
  chartError: string | null;
  searchLoad: "idle" | "loading" | "ready" | "error";
};

export type GalaxyControllerStore = Pick<ChartShardStore, "load" | "prefetch" | "pin" | "unpin" | "dispose">;
export type GalaxyControllerCatalog = Pick<GalaxySearchCatalog, "load" | "find" | "get">;
export type GalaxyControllerEngine = Pick<ProgressiveStarEngine, "upsertChart" | "removeChart" | "setChart" | "focusStar">;

type GalaxyControllerInput = {
  manifest: GalaxyManifest;
  store: GalaxyControllerStore;
  catalog: GalaxyControllerCatalog;
  engine: GalaxyControllerEngine;
  saveData: boolean;
};

export function galaxyStoreOptions(isNarrow: boolean): { capacity: number; concurrency: number } {
  return isNarrow ? { capacity: 3, concurrency: 2 } : { capacity: 8, concurrency: 4 };
}

function errorMessage(error: unknown): string {
  return error instanceof Error && error.message ? error.message : "This chart could not be loaded.";
}

export class GalaxyController {
  private readonly manifest: GalaxyManifest;
  private readonly store: GalaxyControllerStore;
  private readonly catalog: GalaxyControllerCatalog;
  private readonly engine: GalaxyControllerEngine;
  private readonly listeners = new Set<(status: GalaxyControllerStatus) => void>();
  private readonly loadedCharts = new Set<string>();
  private readonly prefetchedCharts = new Set<string>();
  private status: GalaxyControllerStatus = {
    chartId: null,
    chartLoad: "idle",
    chartError: null,
    searchLoad: "idle",
  };
  private selectionRevision = 0;
  private approachRevision = 0;
  private pinnedChartId: string | null = null;
  private requestedChartId: string | null = null;
  private prefetchTimer: ReturnType<typeof setTimeout> | null = null;
  private saveData: boolean;
  private disposed = false;

  constructor(input: GalaxyControllerInput) {
    this.manifest = input.manifest;
    this.store = input.store;
    this.catalog = input.catalog;
    this.engine = input.engine;
    this.saveData = input.saveData;
  }

  openChart(chartId: string): Promise<ChartShard | null> {
    this.foregroundAction();
    const revision = ++this.selectionRevision;
    return this.openChartForSelection(chartId, revision);
  }

  foregroundAction(): void {
    this.cancelApproachPrefetch();
  }

  clearSelection(): void {
    this.foregroundAction();
    this.selectionRevision += 1;
    const requestedChartId = this.requestedChartId;
    this.requestedChartId = null;
    if (requestedChartId && requestedChartId !== this.pinnedChartId) this.store.unpin(requestedChartId);
    if (this.pinnedChartId) this.store.unpin(this.pinnedChartId);
    this.pinnedChartId = null;
    this.engine.setChart(null);
    this.update({ chartId: null, chartLoad: "idle", chartError: null });
  }

  async openWord(lemma: string): Promise<boolean> {
    this.foregroundAction();
    const revision = ++this.selectionRevision;
    if (!await this.ensureCatalog(revision)) return false;
    const entry = this.catalog.get(lemma);
    if (!entry || revision !== this.selectionRevision || this.disposed) return false;
    const shard = await this.openChartForSelection(entry.chartId, revision);
    if (!shard || revision !== this.selectionRevision || this.disposed) return false;
    return this.engine.focusStar(entry.lemma, { keepCamera: false });
  }

  async search(query: string): Promise<SearchEntry[]> {
    this.foregroundAction();
    const entries = await this.loadCatalog();
    return entries ? this.catalog.find(query) : [];
  }

  async loadCatalog(): Promise<SearchEntry[] | null> {
    if (this.disposed) return null;
    this.update({ searchLoad: "loading" });
    try {
      const entries = await this.catalog.load();
      if (this.disposed) return null;
      this.update({ searchLoad: "ready" });
      return entries;
    } catch {
      if (!this.disposed) this.update({ searchLoad: "error" });
      return null;
    }
  }

  approachChart(chartId: string | null): void {
    const revision = this.cancelApproachPrefetch();
    if (!chartId || this.disposed) return;

    void this.store.load(chartId, { pin: false }).then((shard) => {
      if (this.disposed || revision !== this.approachRevision) return;
      this.loadedCharts.add(chartId);
      this.engine.upsertChart(shard);
      this.scheduleNeighborPrefetch(chartId, revision);
    }).catch(() => undefined);
  }

  evictChart(chartId: string): void {
    this.loadedCharts.delete(chartId);
    this.prefetchedCharts.delete(chartId);
  }

  setSaveData(value: boolean): void {
    this.saveData = value;
    if (value) this.clearPrefetch();
  }

  retryChart(): Promise<ChartShard | null> {
    const chartId = this.status.chartId;
    return chartId ? this.openChart(chartId) : Promise.resolve(null);
  }

  subscribe(listener: (status: GalaxyControllerStatus) => void): () => void {
    this.listeners.add(listener);
    listener(this.status);
    return () => this.listeners.delete(listener);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.selectionRevision += 1;
    this.approachRevision += 1;
    this.clearPrefetch();
    this.listeners.clear();
    this.store.dispose();
  }

  private async openChartForSelection(chartId: string, revision: number): Promise<ChartShard | null> {
    if (this.disposed || revision !== this.selectionRevision) return null;
    this.requestedChartId = chartId;
    this.update({ chartId, chartLoad: "loading", chartError: null });
    try {
      const shard = await this.store.load(chartId, { pin: true });
      if (this.disposed || revision !== this.selectionRevision) {
        if (this.requestedChartId !== chartId && this.pinnedChartId !== chartId) this.store.unpin(chartId);
        return null;
      }

      const previousChartId = this.pinnedChartId;
      this.loadedCharts.add(chartId);
      this.engine.upsertChart(shard);
      this.engine.setChart(chartId);
      this.pinnedChartId = chartId;
      if (previousChartId && previousChartId !== chartId) this.store.unpin(previousChartId);
      this.update({ chartId, chartLoad: "ready", chartError: null });
      return shard;
    } catch (error) {
      if (this.disposed || revision !== this.selectionRevision) return null;
      this.store.unpin(chartId);
      this.update({ chartId, chartLoad: "error", chartError: errorMessage(error) });
      return null;
    }
  }

  private async ensureCatalog(revision: number): Promise<boolean> {
    if (this.disposed || revision !== this.selectionRevision) return false;
    const entries = await this.loadCatalog();
    return !!entries && !this.disposed && revision === this.selectionRevision;
  }

  private scheduleNeighborPrefetch(chartId: string, revision: number): void {
    if (this.saveData || this.disposed) return;
    const chart = this.manifest.charts.find((candidate) => candidate.id === chartId);
    const neighbor = chart?.neighbors
      .filter((candidate) => !this.loadedCharts.has(candidate.chartId) && !this.prefetchedCharts.has(candidate.chartId))
      .sort((left, right) => right.weight - left.weight)[0];
    if (!neighbor) return;
    this.prefetchTimer = setTimeout(() => {
      this.prefetchTimer = null;
      if (this.disposed || this.saveData || revision !== this.approachRevision) return;
      this.prefetchedCharts.add(neighbor.chartId);
      this.store.prefetch(neighbor.chartId);
    }, 750);
  }

  private clearPrefetch(): void {
    if (!this.prefetchTimer) return;
    clearTimeout(this.prefetchTimer);
    this.prefetchTimer = null;
  }

  private cancelApproachPrefetch(): number {
    this.approachRevision += 1;
    this.clearPrefetch();
    return this.approachRevision;
  }

  private update(patch: Partial<GalaxyControllerStatus>): void {
    this.status = { ...this.status, ...patch };
    for (const listener of this.listeners) listener(this.status);
  }
}
