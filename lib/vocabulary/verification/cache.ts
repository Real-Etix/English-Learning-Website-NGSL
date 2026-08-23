import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { z } from "zod";

export interface CacheKeyInput {
  provider: string;
  version: string;
  request: unknown;
  model?: string;
  promptVersion?: string;
  [key: string]: unknown;
}

export interface VerificationCache {
  get<T>(namespace: string, key: string, schema: z.ZodType<T>): Promise<T | null>;
  set<T>(namespace: string, key: string, value: T, schema: z.ZodType<T>): Promise<void>;
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value !== null && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return Object.fromEntries(
      Object.keys(record).sort().map((key) => [key, canonicalize(record[key])]),
    );
  }
  return value;
}

export function canonicalVerificationJson(value: unknown): string {
  const serialized = JSON.stringify(canonicalize(value));
  if (serialized === undefined) throw new TypeError("value must be JSON-serializable");
  return serialized;
}

function cacheNamespace(value: string): string {
  if (!value || !/^[A-Za-z0-9_-]+$/.test(value)) {
    throw new Error("cache namespace must be a safe cache path segment");
  }
  return value;
}

export function verificationCacheKey(input: CacheKeyInput): string {
  const provider = cacheNamespace(input.provider);
  const digest = createHash("sha256")
    .update(canonicalVerificationJson(input), "utf8")
    .digest("hex");
  return `${provider}/${digest}`;
}

function parseCacheKey(key: string): { namespace: string; digest: string } {
  const parts = key.split("/");
  if (parts.length !== 2) throw new Error("cache key must contain a namespace and digest");
  const namespace = cacheNamespace(parts[0]!);
  const digest = parts[1]!;
  if (!/^[0-9a-f]{64}$/.test(digest)) {
    throw new Error("cache key must contain a lowercase SHA-256 digest");
  }
  return { namespace, digest };
}

function cacheEntryPath(root: string, key: string): string {
  const { namespace, digest } = parseCacheKey(key);
  return join(root, namespace, `${digest}.json`);
}

export async function readVerificationCache<T>(
  root: string,
  key: string,
  schema: z.ZodType<T>,
): Promise<T | null> {
  const entry = cacheEntryPath(root, key);
  try {
    const stored = JSON.parse(await readFile(entry, "utf8")) as unknown;
    const parsed = schema.safeParse(stored);
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

export async function writeVerificationCache<T>(
  root: string,
  key: string,
  value: T,
  schema: z.ZodType<T>,
): Promise<void> {
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw new Error("cannot write a value that fails the cache schema");

  const { namespace, digest } = parseCacheKey(key);
  const directory = join(root, namespace);
  const entry = join(directory, `${digest}.json`);
  const temporary = join(directory, `.${digest}.json.${process.pid}.${randomUUID()}.tmp`);
  await mkdir(directory, { recursive: true });
  try {
    await writeFile(temporary, JSON.stringify(parsed.data), "utf8");
    await rename(temporary, entry);
  } finally {
    await unlink(temporary).catch(() => undefined);
  }
}

function scopedKey(namespace: string, key: string): string {
  const safeNamespace = cacheNamespace(namespace);
  if (key.includes("/")) {
    const parsed = parseCacheKey(key);
    if (parsed.namespace !== safeNamespace) {
      throw new Error("cache key namespace does not match wrapper namespace");
    }
    return key;
  }

  const scoped = `${safeNamespace}/${key}`;
  parseCacheKey(scoped);
  return scoped;
}

export function createVerificationCache(root: string): VerificationCache {
  return {
    async get<T>(namespace: string, key: string, schema: z.ZodType<T>): Promise<T | null> {
      return readVerificationCache(root, scopedKey(namespace, key), schema);
    },
    async set<T>(namespace: string, key: string, value: T, schema: z.ZodType<T>): Promise<void> {
      return writeVerificationCache(root, scopedKey(namespace, key), value, schema);
    },
  };
}
