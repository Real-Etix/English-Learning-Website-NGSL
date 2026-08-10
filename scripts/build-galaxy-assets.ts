import { gzipSync } from "node:zlib";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import { buildGalaxyArtifacts } from "../lib/galaxy/build-artifacts";
import { decodeFullGalaxy } from "../lib/galaxy/full-codec";
import type { LiteGraph } from "../lib/wiki/parse-wiki";

const LISTS = {
  ngsl: "NGSL",
  toeic: "TOEIC",
  business: "Business",
  academic: "Academic",
  fitness: "Fitness",
  all: "All words",
} as const;

const ROOT = path.join(process.cwd(), "public", "generated", "galaxy");
const MANIFEST_LIMIT = 102_400;
const ALL_MANIFEST_LIMIT = 153_600;

function fullArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

function assertArtifactCounts(graph: LiteGraph, bundle: ReturnType<typeof buildGalaxyArtifacts>): void {
  const expected = graph.nodes.length;
  const shardWords = bundle.chartShards.reduce((count, shard) => count + shard.data.words.length, 0);
  const fullWords = decodeFullGalaxy(fullArrayBuffer(bundle.full.bytes)).words.length;
  if (shardWords !== expected || bundle.search.data.entries.length !== expected || fullWords !== expected) {
    throw new Error(`Invalid galaxy artifact count for ${graph.slug}: expected ${expected}, got ${shardWords} shard, ${bundle.search.data.entries.length} search, ${fullWords} full`);
  }
}

async function main(): Promise<void> {
  const manifestsDir = path.join(ROOT, "manifests");
  const assetsDir = path.join(ROOT, "assets");
  await rm(ROOT, { recursive: true, force: true });
  await mkdir(manifestsDir, { recursive: true });
  await mkdir(assetsDir, { recursive: true });

  for (const [slug, label] of Object.entries(LISTS)) {
    const graphPath = path.join(process.cwd(), "data", "generated", "graphs", `${slug}.json`);
    const graph = JSON.parse(await readFile(graphPath, "utf8")) as LiteGraph;
    const bundle = buildGalaxyArtifacts(graph, label);
    assertArtifactCounts(graph, bundle);

    const manifestJson = JSON.stringify(bundle.manifest);
    const manifestBytes = Buffer.byteLength(manifestJson);
    const gzipManifestBytes = gzipSync(manifestJson).byteLength;
    const limit = slug === "all" ? ALL_MANIFEST_LIMIT : MANIFEST_LIMIT;
    if (gzipManifestBytes > limit) {
      throw new Error(`Galaxy manifest for ${slug} is ${gzipManifestBytes} bytes gzipped; limit is ${limit}`);
    }

    const assets = [
      ...bundle.chartShards.map(({ fileName, bytes }) => ({ fileName, bytes })),
      bundle.search,
      bundle.full,
    ];
    await Promise.all(assets.map(({ fileName, bytes }) => writeFile(path.join(assetsDir, fileName), bytes)));
    await writeFile(path.join(manifestsDir, `${slug}.json`), manifestJson);

    const assetBytes = assets.reduce((total, asset) => total + asset.bytes.byteLength, 0);
    console.log(`${slug}: charts=${bundle.manifest.list.chartCount}, stars=${graph.nodes.length}, asset-bytes=${assetBytes}, raw-manifest-bytes=${manifestBytes}, gzip-manifest-bytes=${gzipManifestBytes}`);
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
