"use client";

import dynamic from "next/dynamic";

import type { GalaxyManifest } from "@/lib/galaxy/types";

const StarAtlas = dynamic(
  () => import("./star-atlas").then((module) => module.StarAtlas),
  {
    ssr: false,
    loading: () => (
      <div
        aria-live="polite"
        className="atlas-loading-shell"
        style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center", background: "#070B16", color: "#94A0B4" }}
      >
        Charting constellations…
      </div>
    ),
  },
);

export function StarAtlasEntry(props: { manifest: GalaxyManifest; listSlug: string }) {
  return <StarAtlas key={props.manifest.version} {...props} />;
}
