"use client";

import { useMemo } from "react";

import { getFullModeActionLabel } from "../full-galaxy-dialog";

import type { FullModeState } from "./full-mode-state";

import type { ChartShard, GalaxyChart, GalaxyManifest } from "../../../lib/galaxy/types";

const VIEWBOX_WIDTH = 1000;
const VIEWBOX_HEIGHT = 700;
const VIEWBOX_PADDING = 72;

export const FULL_3D_UNAVAILABLE_MESSAGE = "Full 3D mode is unavailable in this browser.";

export function getFallbackFullModeControl(
  listLabel: string,
  phase: FullModeState["phase"],
  renderFallback: boolean,
): { label: string; disabled: boolean } {
  if (renderFallback) return { label: FULL_3D_UNAVAILABLE_MESSAGE, disabled: true };
  return { label: getFullModeActionLabel(listLabel, phase), disabled: false };
}

export type ProjectedFallbackChart = {
  chart: GalaxyChart;
  x: number;
  y: number;
  radius: number;
};

type FallbackController = {
  openChart(chartId: string): Promise<ChartShard | null>;
  openWord(lemma: string): Promise<boolean>;
};

function projectRaw(chart: GalaxyChart): { chart: GalaxyChart; x: number; y: number } {
  return {
    chart,
    x: chart.center[0] + chart.center[2] * 0.24,
    y: chart.center[1] * 0.82 - chart.center[2] * 0.18,
  };
}

export function projectChartsToConstellation(charts: GalaxyChart[]): ProjectedFallbackChart[] {
  if (charts.length === 0) return [];
  const raw = charts.map(projectRaw);
  const minX = Math.min(...raw.map((chart) => chart.x));
  const maxX = Math.max(...raw.map((chart) => chart.x));
  const minY = Math.min(...raw.map((chart) => chart.y));
  const maxY = Math.max(...raw.map((chart) => chart.y));
  const spanX = Math.max(1, maxX - minX);
  const spanY = Math.max(1, maxY - minY);
  const scale = Math.min(
    (VIEWBOX_WIDTH - VIEWBOX_PADDING * 2) / spanX,
    (VIEWBOX_HEIGHT - VIEWBOX_PADDING * 2) / spanY,
  );

  return raw.map((entry) => ({
    chart: entry.chart,
    x: VIEWBOX_PADDING + (entry.x - minX) * scale,
    y: VIEWBOX_PADDING + (entry.y - minY) * scale,
    radius: Math.max(28, 12 + Math.sqrt(Math.max(1, entry.chart.wordCount)) * 1.2),
  }));
}

function onActivateKey(
  event: React.KeyboardEvent<SVGGElement | HTMLButtonElement>,
  activate: () => void,
): void {
  if (event.key !== "Enter" && event.key !== " ") return;
  event.preventDefault();
  activate();
}

export function FallbackConstellation({
  manifest,
  controller,
  selectedChartId,
  selectedLemma,
  selectedShard,
  owned,
  used,
  route,
}: {
  manifest: GalaxyManifest;
  controller: FallbackController | null;
  selectedChartId: string | null;
  selectedLemma: string | null;
  selectedShard: ChartShard | null;
  owned: ReadonlySet<string>;
  used: ReadonlySet<string>;
  route: ReadonlySet<string>;
}) {
  const projectedCharts = useMemo(() => projectChartsToConstellation(manifest.charts), [manifest.charts]);
  const selectedChart = selectedChartId ? manifest.charts.find((chart) => chart.id === selectedChartId) ?? null : null;
  const readyText = selectedShard && selectedChart
    ? `${selectedChart.name} words ready · ${selectedShard.words.length} words`
    : selectedChart
      ? `Loading ${selectedChart.name}…`
      : "Choose a chart to browse its words.";

  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        display: "grid",
        gridTemplateColumns: "minmax(0, 1.6fr) minmax(280px, 0.9fr)",
        gap: 16,
        padding: 16,
        pointerEvents: "auto",
      }}
    >
      <section
        aria-label={`${manifest.list.label} constellation fallback`}
        style={{
          minWidth: 0,
          padding: 14,
          borderRadius: 18,
          border: "1px solid rgba(241,238,230,.08)",
          background: "rgba(10,15,28,.72)",
          backdropFilter: "blur(18px)",
          boxShadow: "0 20px 50px rgba(0,0,0,.36)",
        }}
      >
        <svg
          viewBox={`0 0 ${VIEWBOX_WIDTH} ${VIEWBOX_HEIGHT}`}
          role="img"
          aria-label={`${manifest.list.label} chart constellation`}
          style={{ display: "block", width: "100%", height: "100%" }}
        >
          <rect x="0" y="0" width={VIEWBOX_WIDTH} height={VIEWBOX_HEIGHT} rx="20" fill="rgba(7,11,22,.9)" />
          {projectedCharts.map(({ chart, x, y, radius }) => {
            const active = chart.id === selectedChartId;
            const chartWords = selectedShard?.chartId === chart.id ? selectedShard.words.length : chart.wordCount;
            const activate = () => { void controller?.openChart(chart.id); };
            return (
              <g
                key={chart.id}
                data-fallback-chart=""
                role="button"
                tabIndex={0}
                aria-label={`${chart.name}, ${chartWords} words`}
                onClick={activate}
                onKeyDown={(event) => onActivateKey(event, activate)}
                style={{ cursor: "pointer" }}
              >
                <circle
                  className="fallback-hit"
                  cx={x}
                  cy={y}
                  r={radius}
                  fill={active ? "rgba(191,217,242,.22)" : "rgba(191,217,242,.11)"}
                  stroke={active ? "#F1EEE6" : chart.hue}
                  strokeWidth={active ? 4 : 2}
                />
                <circle
                  cx={x}
                  cy={y}
                  r={Math.max(10, radius * 0.44)}
                  fill={chart.hue}
                  fillOpacity={chart.id === "drift" ? 0.5 : 0.86}
                />
                <text
                  x={x}
                  y={y - radius - 10}
                  textAnchor="middle"
                  style={{
                    fill: "#F1EEE6",
                    fontFamily: "var(--font-atlas-mono), ui-monospace, monospace",
                    fontSize: "14px",
                    letterSpacing: "0.08em",
                  }}
                >
                  {chart.glyph} {chart.name}
                </text>
                <text
                  x={x}
                  y={y + radius + 20}
                  textAnchor="middle"
                  style={{
                    fill: active ? "#F1EEE6" : "#94A0B4",
                    fontFamily: "var(--font-atlas-sans), system-ui, sans-serif",
                    fontSize: "13px",
                  }}
                >
                  {active ? "Selected" : `${chart.wordCount} words`}
                </text>
              </g>
            );
          })}
        </svg>
      </section>

      <aside
        aria-label={selectedChart ? `${selectedChart.name} words` : "Chart words"}
        style={{
          minWidth: 0,
          display: "flex",
          flexDirection: "column",
          gap: 12,
          padding: 14,
          borderRadius: 18,
          border: "1px solid rgba(241,238,230,.08)",
          background: "rgba(10,15,28,.82)",
          backdropFilter: "blur(18px)",
          boxShadow: "0 20px 50px rgba(0,0,0,.36)",
        }}
      >
        <div aria-live="polite" style={{ font: "500 11px/1.5 var(--font-atlas-mono), ui-monospace, monospace", color: "#BFD9F2", letterSpacing: ".06em" }}>
          {readyText}
        </div>
        {selectedShard ? (
          <div style={{ minHeight: 0, overflowY: "auto", display: "flex", flexDirection: "column", gap: 8, paddingRight: 4 }}>
            {selectedShard.words.map((word) => {
              const active = word.lemma === selectedLemma;
              const activate = () => { void controller?.openWord(word.lemma); };
              const badges = [
                used.has(word.lemma) ? "Solid" : null,
                owned.has(word.lemma) ? "Held" : null,
                route.has(word.lemma) ? "Route" : null,
                active ? "Selected" : null,
              ].filter(Boolean);
              return (
                <button
                  key={word.lemma}
                  type="button"
                  onClick={activate}
                  onKeyDown={(event) => onActivateKey(event, activate)}
                  style={{
                    width: "100%",
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "flex-start",
                    gap: 6,
                    padding: "10px 12px",
                    borderRadius: 12,
                    border: `1px solid ${active ? "rgba(191,217,242,.36)" : "rgba(241,238,230,.1)"}`,
                    background: active ? "rgba(191,217,242,.12)" : "rgba(241,238,230,.03)",
                    color: "#F1EEE6",
                    cursor: "pointer",
                    textAlign: "left",
                  }}
                >
                  <span style={{ font: "600 13px/1.2 var(--font-atlas-sans), system-ui, sans-serif" }}>{word.display}</span>
                  <span style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                    {badges.map((badge) => (
                      <span
                        key={badge}
                        style={{
                          padding: "2px 7px",
                          borderRadius: 999,
                          border: "1px solid rgba(241,238,230,.12)",
                          font: "500 10px/1.2 var(--font-atlas-mono), ui-monospace, monospace",
                          color: badge === "Selected" ? "#F1EEE6" : badge === "Route" ? "#F2D9A0" : badge === "Solid" ? "#BDFFE0" : "#8FE3C0",
                        }}
                      >
                        {badge}
                      </span>
                    ))}
                  </span>
                </button>
              );
            })}
          </div>
        ) : (
          <p style={{ margin: 0, font: "400 13px/1.65 var(--font-atlas-sans), system-ui, sans-serif", color: "#94A0B4" }}>
            Select any chart in the constellation to load its words here. Search, Run, Ladder, Tutor, and the detail drawer still work in this fallback view.
          </p>
        )}
      </aside>
    </div>
  );
}
