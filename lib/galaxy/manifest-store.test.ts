import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { buildGalaxyArtifacts } from "./build-artifacts";
import { loadGalaxyManifestFrom } from "./manifest-store";
import { fixtureGraph } from "./test-fixture";

describe("manifest store", () => {
  it("reads a generated manifest and rejects unsafe slugs", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "galaxy-manifest-"));
    await mkdir(path.join(root, "manifests"));
    const manifest = buildGalaxyArtifacts({ ...fixtureGraph, slug: "ngsl" }, "NGSL").manifest;
    await writeFile(path.join(root, "manifests", "ngsl.json"), JSON.stringify(manifest));
    await expect(loadGalaxyManifestFrom("ngsl", root)).resolves.toMatchObject({ version: manifest.version });
    await expect(loadGalaxyManifestFrom("../secret", root)).rejects.toThrow(/list slug/i);
  });
});
