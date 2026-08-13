import { readFileSync } from "node:fs";

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { buildGalaxyArtifacts } from "../../lib/galaxy/build-artifacts";
import { fixtureGraph } from "../../lib/galaxy/test-fixture";

import { StarAtlasEntry } from "./star-atlas-entry";

const manifest = buildGalaxyArtifacts(fixtureGraph, "Fixture").manifest;

describe("StarAtlasEntry", () => {
  it("avoids synchronous loader resets inside the deferred import effect", () => {
    const source = readFileSync(
      new URL("./star-atlas-entry.tsx", import.meta.url),
      "utf8",
    );

    expect(source).not.toContain("setStarAtlas(null)");
  });

  it("renders a lightweight DOM/CSS preview shell before mounting the full atlas controls", () => {
    const html = renderToStaticMarkup(
      <StarAtlasEntry manifest={manifest} listSlug="fixture" />,
    );

    expect(html).toContain('data-testid="star-atlas-entry-shell"');
    expect(html).toContain('data-testid="galaxy-status"');
    expect(html).toContain(
      `Constellation view · ${manifest.list.chartCount} charts · ${manifest.list.wordCount.toLocaleString()} stars`,
    );
    expect(html).toContain("observatory controls load");
    expect(html).not.toContain("<svg");
    expect(html).not.toContain("constellation fallback");
    expect(html).not.toContain(`Search ${manifest.list.label} stars`);
  });
});
