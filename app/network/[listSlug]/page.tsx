import { notFound } from "next/navigation";
import { IBM_Plex_Mono, IBM_Plex_Sans, Instrument_Serif } from "next/font/google";

import { StarAtlasEntry } from "@/components/network/star-atlas-entry";
import { getListBySlug } from "@/lib/content/content-service";
import { loadGalaxyManifest } from "@/lib/galaxy/manifest-store";
import type { LearningListSlug } from "@/lib/types";

// The Star Atlas typeface system — a serif for display, Plex Sans for body,
// Plex Mono for the observatory's instrument labels. Exposed as CSS variables
// so the client component can mirror the prototype's inline font shorthands.
const serif = Instrument_Serif({
  weight: "400",
  style: ["normal", "italic"],
  subsets: ["latin"],
  variable: "--font-atlas-serif",
  display: "swap",
});
const sans = IBM_Plex_Sans({
  weight: ["400", "500", "600", "700"],
  subsets: ["latin"],
  variable: "--font-atlas-sans",
  display: "swap",
});
const mono = IBM_Plex_Mono({
  weight: ["400", "500", "600"],
  subsets: ["latin"],
  variable: "--font-atlas-mono",
  display: "swap",
});

// Pre-render each list galaxy at build time (reads the 11k wiki files on the
// build machine, not per request) so the deployed pages are static and fast.
export function generateStaticParams() {
  return ["ngsl", "toeic", "business", "academic", "fitness", "all"].map((listSlug) => ({
    listSlug,
  }));
}

export default async function NetworkPage({
  params,
}: {
  params: Promise<{ listSlug: string }>;
}) {
  const { listSlug } = await params;
  const list = listSlug === "all" ? null : getListBySlug(listSlug as LearningListSlug);
  if (listSlug !== "all" && !list) {
    notFound();
  }

  const manifest = await loadGalaxyManifest(listSlug);

  return (
    <div
      className={`${serif.variable} ${sans.variable} ${mono.variable}`}
      style={{ position: "fixed", inset: 0, background: "#070B16" }}
    >
      <StarAtlasEntry manifest={manifest} listSlug={listSlug} />
    </div>
  );
}
