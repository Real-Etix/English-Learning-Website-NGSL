"use client";

import { useEffect, useState } from "react";

import {
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

function StarAtlasEntryShell({ manifest }: { manifest: GalaxyManifest }) {
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
