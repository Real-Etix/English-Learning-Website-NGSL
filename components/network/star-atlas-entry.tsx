"use client";

import { useEffect, useState } from "react";

import {
  markGalaxyConstellationVisible,
  markGalaxyCriticalReady,
  scheduleDeferredEngineBoot,
} from "./galaxy/deferred-boot";
import type { GalaxyManifest } from "../../lib/galaxy/types";

type StarAtlasComponent = React.ComponentType<{ manifest: GalaxyManifest; listSlug: string }>;

const SHELL_STARS = [
  { left: "14%", top: "18%", size: 2.5, opacity: 0.85 },
  { left: "27%", top: "42%", size: 1.5, opacity: 0.48 },
  { left: "39%", top: "26%", size: 3, opacity: 0.76 },
  { left: "54%", top: "16%", size: 1.5, opacity: 0.58 },
  { left: "66%", top: "37%", size: 2, opacity: 0.66 },
  { left: "73%", top: "23%", size: 3.5, opacity: 0.92 },
  { left: "81%", top: "48%", size: 2, opacity: 0.62 },
  { left: "88%", top: "30%", size: 1.5, opacity: 0.54 },
] as const;

type EntryChartProxy = {
  chartId: string;
  top: string;
  left: string;
  size: number;
  opacity: number;
  blur: number;
  hue: string;
  ambient: boolean;
};

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function buildEntryChartProxies(manifest: GalaxyManifest): EntryChartProxy[] {
  return manifest.charts.map((chart, index) => {
    const horizontal = clamp(50 + chart.center[0] * 0.075 + chart.center[2] * 0.018, 12, 88);
    const vertical = clamp(48 - chart.center[1] * 0.11 + chart.center[2] * 0.012, 16, 82);
    const ambient = chart.id === "drift";
    const size = ambient
      ? clamp(5 + Math.sqrt(Math.max(1, chart.wordCount)) * 0.5, 6, 12)
      : clamp(14 + Math.sqrt(Math.max(1, chart.wordCount)) * 1.2, 16, 34);

    return {
      chartId: chart.id,
      left: `${horizontal.toFixed(1)}%`,
      top: `${(vertical + ((index % 3) - 1) * 1.6).toFixed(1)}%`,
      size,
      opacity: ambient ? 0.52 : 0.72,
      blur: ambient ? 8 : 18,
      hue: chart.hue,
      ambient,
    };
  });
}

function StarAtlasEntryShell({ manifest }: { manifest: GalaxyManifest }) {
  const proxies = buildEntryChartProxies(manifest);

  return (
    <div
      data-testid="star-atlas-entry-shell"
      style={{
        position: "absolute",
        inset: 0,
        overflow: "hidden",
        background: [
          "radial-gradient(circle at 18% 20%, rgba(105, 140, 255, 0.16), transparent 24%)",
          "radial-gradient(circle at 82% 18%, rgba(164, 122, 255, 0.12), transparent 18%)",
          "linear-gradient(180deg, #040814 0%, #08101d 52%, #0a1220 100%)",
        ].join(", "),
      }}
    >
      <div aria-hidden="true" style={{ position: "absolute", inset: 0 }}>
        <div
          style={{
            position: "absolute",
            insetInline: "8%",
            bottom: "14%",
            height: 1,
            background: "linear-gradient(90deg, transparent, rgba(138, 170, 255, 0.32), transparent)",
          }}
        />
        <div
          style={{
            position: "absolute",
            left: "11%",
            top: "56%",
            width: "32%",
            height: 1,
            transform: "rotate(-9deg)",
            transformOrigin: "left center",
            background: "linear-gradient(90deg, rgba(120, 155, 255, 0), rgba(120, 155, 255, 0.26), rgba(120, 155, 255, 0))",
          }}
        />
        <div
          style={{
            position: "absolute",
            right: "18%",
            top: "36%",
            width: "24%",
            height: 1,
            transform: "rotate(12deg)",
            transformOrigin: "right center",
            background: "linear-gradient(90deg, rgba(180, 146, 255, 0), rgba(180, 146, 255, 0.22), rgba(180, 146, 255, 0))",
          }}
        />
        {SHELL_STARS.map((star, index) => (
          <span
            key={`${star.left}-${star.top}-${index}`}
            style={{
              position: "absolute",
              left: star.left,
              top: star.top,
              width: star.size,
              height: star.size,
              borderRadius: "50%",
              opacity: star.opacity,
              background: "#F3F6FF",
              boxShadow: "0 0 8px rgba(215, 228, 255, 0.45)",
            }}
          />
        ))}
        {proxies.map((proxy) => (
          <span
            key={proxy.chartId}
            aria-hidden="true"
            data-chart-proxy={proxy.chartId}
            data-chart-id={proxy.chartId}
            style={{
              position: "absolute",
              left: proxy.left,
              top: proxy.top,
              width: proxy.size,
              height: proxy.size,
              borderRadius: "50%",
              opacity: proxy.opacity,
              transform: "translate(-50%, -50%)",
              background: `radial-gradient(circle, rgba(243, 246, 255, 0.98) 0%, ${proxy.hue} 45%, rgba(255, 255, 255, 0) 100%)`,
              boxShadow: `0 0 ${proxy.blur}px color-mix(in srgb, ${proxy.hue} 62%, rgba(214, 228, 255, 0.55))`,
              filter: proxy.ambient ? "saturate(0.72)" : "none",
            }}
          />
        ))}
      </div>
      <div
        data-testid="galaxy-status"
        aria-live="polite"
        role="status"
        style={{
          position: "absolute",
          left: "50%",
          top: 68,
          zIndex: 2,
          transform: "translateX(-50%)",
          display: "flex",
          alignItems: "center",
          gap: 8,
          maxWidth: "calc(100% - 32px)",
          padding: "6px 11px",
          borderRadius: 999,
          border: "1px solid rgba(128, 151, 198, .18)",
          background: "rgba(8,12,22,.88)",
          color: "#7C8AA4",
          font: "500 10px/1.3 var(--font-atlas-mono), ui-monospace, monospace",
          letterSpacing: ".04em",
          whiteSpace: "nowrap",
        }}
      >
        <span>
          {`Constellation view · ${manifest.list.chartCount} charts · ${manifest.list.wordCount.toLocaleString()} stars`}
          {" · previewing the sky while observatory controls load…"}
        </span>
      </div>
    </div>
  );
}

function StarAtlasLoader(props: {
  manifest: GalaxyManifest;
  listSlug: string;
  shellKey: string;
}) {
  const [StarAtlas, setStarAtlas] = useState<StarAtlasComponent | null>(null);

  useEffect(() => {
    let active = true;
    markGalaxyCriticalReady();
    markGalaxyConstellationVisible();

    const cancelDeferredMount = scheduleDeferredEngineBoot(() => {
      void import("./star-atlas")
        .then((module) => {
          if (!active) return;
          setStarAtlas(() => module.StarAtlas);
        })
        .catch(() => {
          // Leave the manifest-only preview shell in place if the full atlas
          // chunk fails to load; the existing fallback UI inside StarAtlas
          // still handles runtime WebGL/browser failures after mount.
        });
    });

    return () => {
      active = false;
      cancelDeferredMount();
    };
  }, [props.shellKey]);

  if (!StarAtlas) return <StarAtlasEntryShell manifest={props.manifest} />;

  return <StarAtlas key={props.manifest.version} {...props} />;
}

export function StarAtlasEntry(props: { manifest: GalaxyManifest; listSlug: string }) {
  const shellKey = `${props.listSlug}:${props.manifest.version}`;

  return <StarAtlasLoader key={shellKey} {...props} shellKey={shellKey} />;
}
