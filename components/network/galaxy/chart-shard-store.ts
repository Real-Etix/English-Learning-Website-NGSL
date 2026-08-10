import { GalaxyAssetError, fetchVersionedJson } from "./asset-client";

import { isChartShard, type ChartShard, type GalaxyManifest } from "../../../lib/galaxy/types";

export type StoreOptions = {
  capacity: number;
  concurrency: number;
  fetcher?: typeof fetch;
  onEvict?: (chartId: string, shard: ChartShard) => void;
  refreshManifest?: () => Promise<GalaxyManifest>;
};

type LoadOptions = { pin?: boolean };
type Task = {
  chartId: string;
  foreground: boolean;
  controller: AbortController;
  promise: Promise<ChartShard>;
  resolve: (shard: ChartShard) => void;
  reject: (error: unknown) => void;
};

function abortError(): DOMException {
  return new DOMException("Galaxy shard loading was cancelled", "AbortError");
}

export class ChartShardStore {
  private manifest: GalaxyManifest;
  private readonly resident = new Map<string, ChartShard>();
  private readonly pins = new Set<string>();
  private readonly pending = new Map<string, Task>();
  private readonly foreground: Task[] = [];
  private readonly prefetches: Task[] = [];
  private active = 0;
  private disposed = false;

  constructor(manifest: GalaxyManifest, private readonly options: StoreOptions) {
    if (!Number.isInteger(options.capacity) || options.capacity < 1) throw new RangeError("capacity must be a positive integer");
    if (!Number.isInteger(options.concurrency) || options.concurrency < 1) throw new RangeError("concurrency must be a positive integer");
    this.manifest = manifest;
  }

  load(chartId: string, options: LoadOptions = {}): Promise<ChartShard> {
    if (options.pin) this.pin(chartId);
    const resident = this.get(chartId);
    if (resident) return Promise.resolve(resident);
    if (this.disposed) return Promise.reject(abortError());
    if (!this.findChart(chartId)) return Promise.reject(new GalaxyAssetError("decode", `Unknown galaxy chart: ${chartId}`));

    const pending = this.pending.get(chartId);
    if (pending) {
      this.promote(pending);
      return pending.promise;
    }

    let resolve!: (shard: ChartShard) => void;
    let reject!: (error: unknown) => void;
    const task: Task = {
      chartId,
      foreground: true,
      controller: new AbortController(),
      promise: new Promise<ChartShard>((resolveTask, rejectTask) => {
        resolve = resolveTask;
        reject = rejectTask;
      }),
      resolve,
      reject,
    };
    this.pending.set(chartId, task);
    this.foreground.push(task);
    this.drain();
    return task.promise;
  }

  prefetch(chartId: string): void {
    if (this.resident.has(chartId) || this.pending.has(chartId) || this.disposed || !this.findChart(chartId)) return;

    let resolve!: (shard: ChartShard) => void;
    let reject!: (error: unknown) => void;
    const task: Task = {
      chartId,
      foreground: false,
      controller: new AbortController(),
      promise: new Promise<ChartShard>((resolveTask, rejectTask) => {
        resolve = resolveTask;
        reject = rejectTask;
      }),
      resolve,
      reject,
    };
    this.pending.set(chartId, task);
    this.prefetches.push(task);
    void task.promise.catch(() => undefined);
    this.drain();
  }

  get(chartId: string): ChartShard | null {
    const shard = this.resident.get(chartId);
    if (!shard) return null;
    this.resident.delete(chartId);
    this.resident.set(chartId, shard);
    return shard;
  }

  pin(chartId: string): void {
    this.pins.add(chartId);
  }

  unpin(chartId: string): void {
    this.pins.delete(chartId);
    this.trim();
  }

  residentIds(): string[] {
    return [...this.resident.keys()];
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const task of this.pending.values()) {
      task.controller.abort();
      task.reject(abortError());
    }
    this.pending.clear();
    this.foreground.length = 0;
    this.prefetches.length = 0;
    this.resident.clear();
    this.pins.clear();
  }

  private promote(task: Task): void {
    if (task.foreground) return;
    const index = this.prefetches.indexOf(task);
    if (index < 0) return;
    this.prefetches.splice(index, 1);
    task.foreground = true;
    this.foreground.push(task);
  }

  private drain(): void {
    while (!this.disposed && this.active < this.options.concurrency) {
      const task = this.foreground.shift() ?? this.prefetches.shift();
      if (!task) return;
      this.active += 1;
      void this.run(task).then(task.resolve, task.reject).finally(() => {
        this.active -= 1;
        if (this.pending.get(task.chartId) === task) this.pending.delete(task.chartId);
        this.drain();
      });
    }
  }

  private async run(task: Task): Promise<ChartShard> {
    for (let attempt = 0; ; attempt += 1) {
      const chart = this.findChart(task.chartId);
      if (!chart) throw new GalaxyAssetError("decode", `Unknown galaxy chart: ${task.chartId}`);
      try {
        const shard = await fetchVersionedJson(chart.asset.url, this.manifest.version, task.controller.signal, isChartShard, this.options.fetcher);
        if (this.disposed) throw abortError();
        if (shard.chartId !== task.chartId || shard.listSlug !== this.manifest.list.slug) {
          throw new GalaxyAssetError("decode", "Invalid galaxy asset");
        }
        this.addResident(task.chartId, shard);
        return shard;
      } catch (error) {
        if (!(error instanceof GalaxyAssetError) || error.code !== "version" || attempt > 0 || !this.options.refreshManifest) throw error;
        this.manifest = await this.options.refreshManifest();
      }
    }
  }

  private addResident(chartId: string, shard: ChartShard): void {
    while (this.resident.size >= this.options.capacity) {
      const evicted = this.evictOne();
      if (!evicted) return;
    }
    this.resident.delete(chartId);
    this.resident.set(chartId, shard);
  }

  private trim(): void {
    while (this.resident.size > this.options.capacity && this.evictOne()) {
      // Evict until the bounded resident set is restored.
    }
  }

  private evictOne(): boolean {
    for (const [chartId, shard] of this.resident) {
      if (this.pins.has(chartId)) continue;
      this.resident.delete(chartId);
      this.options.onEvict?.(chartId, shard);
      return true;
    }
    return false;
  }

  private findChart(chartId: string) {
    return this.manifest.charts.find((chart) => chart.id === chartId);
  }
}
