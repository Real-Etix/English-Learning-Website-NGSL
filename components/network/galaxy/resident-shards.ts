import type { ChartShard } from "../../../lib/galaxy/types";

type EvictionEngine = {
  removeChart(chartId: string): void;
};

type EvictionController = {
  evictChart(chartId: string): void;
};

type ResidentShardUpdater = (
  update: (previous: Map<string, ChartShard>) => Map<string, ChartShard>,
) => void;

type ChartEvictionHandlerInput = {
  engine: EvictionEngine;
  getController: () => EvictionController | null;
  updateResidentShards: ResidentShardUpdater;
};

export function removeResidentShard(
  previous: Map<string, ChartShard>,
  chartId: string,
): Map<string, ChartShard> {
  if (!previous.has(chartId)) return previous;
  const next = new Map(previous);
  next.delete(chartId);
  return next;
}

export function createChartEvictionHandler({
  engine,
  getController,
  updateResidentShards,
}: ChartEvictionHandlerInput): (chartId: string) => void {
  return (chartId) => {
    engine.removeChart(chartId);
    getController()?.evictChart(chartId);
    updateResidentShards((previous) => removeResidentShard(previous, chartId));
  };
}
