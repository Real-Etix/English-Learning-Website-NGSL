import { describe, expect, it, vi } from "vitest";

import { GalaxySearchCatalog } from "./search-catalog";
import { buildGalaxyArtifacts } from "../../../lib/galaxy/build-artifacts";
import { fixtureGraph } from "../../../lib/galaxy/test-fixture";

const bundle = buildGalaxyArtifacts(fixtureGraph, "Fixture");
const manifest = bundle.manifest;
const searchData = bundle.search.data;

describe("GalaxySearchCatalog", () => {
  it("rejects malformed entries before normalized reaches startsWith", async () => {
    const malformed = structuredClone(searchData) as unknown as {
      entries: Record<string, unknown>[];
    };
    malformed.entries[0].normalized = 7;
    const fetcher = vi.fn(async () => new Response(JSON.stringify(malformed), { status: 200 })) as typeof fetch;
    const catalog = new GalaxySearchCatalog(manifest, { fetcher });

    await expect(catalog.load()).rejects.toMatchObject({
      code: "decode",
      cause: { message: "Asset shape did not match its guard" },
    });
    expect(catalog.find("speak")).toEqual([]);
  });

  it("ranks exact, prefix, then one-edit fuzzy matches", () => {
    const catalog = GalaxySearchCatalog.fromData(searchData);

    expect(catalog.find("speak")[0].lemma).toBe("speak");
    expect(catalog.find("spe").map((entry) => entry.lemma)).toContain("speak");
    expect(catalog.find("spaek")[0].lemma).toBe("speak");
  });

  it("shares one search-index fetch and never requests the full binary", async () => {
    const fetcher = vi.fn(async (input: string | URL | Request) => {
      expect(String(input)).toBe(manifest.assets.searchIndex.url);
      return new Response(JSON.stringify(searchData), { status: 200 });
    }) as typeof fetch;
    const catalog = new GalaxySearchCatalog(manifest, { fetcher });

    const first = catalog.load();
    const second = catalog.load();
    await expect(Promise.all([first, second])).resolves.toEqual([searchData.entries, searchData.entries]);

    expect(first).toBe(second);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("rejects an index for a different list as a decode error", async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ ...searchData, listSlug: "different-list" }), { status: 200 })) as typeof fetch;
    const catalog = new GalaxySearchCatalog(manifest, { fetcher });

    await expect(catalog.load()).rejects.toMatchObject({ code: "decode" });
  });
});
