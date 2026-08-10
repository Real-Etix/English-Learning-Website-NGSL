import { readFile } from "node:fs/promises";
import path from "node:path";

import { isGalaxyManifest, type GalaxyManifest } from "./types";

const ROOT = path.join(process.cwd(), "public", "generated", "galaxy");
const VALID = new Set(["ngsl", "toeic", "business", "academic", "fitness", "all"]);
const cache = new Map<string, Promise<GalaxyManifest>>();

export async function loadGalaxyManifestFrom(slug: string, root = ROOT): Promise<GalaxyManifest> {
  if (!VALID.has(slug)) throw new Error("Invalid list slug");
  const value: unknown = JSON.parse(await readFile(path.join(root, "manifests", `${slug}.json`), "utf8"));
  if (!isGalaxyManifest(value) || value.list.slug !== slug) throw new Error("Invalid galaxy manifest");
  return value;
}

export function loadGalaxyManifest(slug: string): Promise<GalaxyManifest> {
  const hit = cache.get(slug);
  if (hit) return hit;
  const pending = loadGalaxyManifestFrom(slug).catch((error) => {
    cache.delete(slug);
    throw error;
  });
  cache.set(slug, pending);
  return pending;
}
