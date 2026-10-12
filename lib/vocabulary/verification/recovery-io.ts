import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, statSync, writeFileSync } from "node:fs";
import { open, readFile, unlink } from "node:fs/promises";
import path from "node:path";
import { gunzipSync } from "node:zlib";
import type { VocabularySense } from "../schema";
import { containsVocabularyForm } from "./repair";

const digest = (s: string) => createHash("sha256").update(s).digest("hex");
async function boundedBytes(response: Response, limit: number): Promise<Buffer> {
  const reader = response.body?.getReader();
  if (!reader) throw new Error("Missing response body");
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limit) throw new Error("Source response size limit exceeded");
      chunks.push(value);
    }
    return Buffer.concat(chunks);
  } finally { await reader.cancel().catch(() => {}); }
}
export async function readBounded(response: Response, limit: number): Promise<string> {
  return (await boundedBytes(response, limit)).toString("utf8");
}

/** One instance under the worker lock; synchronous reservations prevent sibling races. */
export class RecoveryCache {
  private size: number;
  private nextRequestAt = 0;
  constructor(private readonly root: string, private readonly limit = 250 * 1024 * 1024) {
    mkdirSync(root, { recursive: true });
    this.size = readdirSync(root).reduce((sum, f) => sum + statSync(path.join(root, f)).size, 0);
    if (this.size > limit) throw new Error("Source cache size limit exceeded");
  }
  async load(key: string): Promise<unknown | null> {
    const file = path.join(this.root, digest(key) + ".json");
    if (!existsSync(file)) return null;
    const raw = JSON.parse(readFileSync(file, "utf8")) as { key: string; value: unknown };
    if (raw.key !== key || !Object.hasOwn(raw, "value")) throw new Error("Invalid source cache envelope");
    return raw.value;
  }
  async save(key: string, value: unknown): Promise<void> {
    const file = path.join(this.root, digest(key) + ".json");
    const text = JSON.stringify({ key, value });
    const bytes = Buffer.byteLength(text);
    // Include the temporary atomic replacement, not just the final file size.
    if (this.size + bytes > this.limit) throw new Error("Source cache size limit exceeded");
    const oldBytes = existsSync(file) ? statSync(file).size : 0;
    const temp = `${file}.${process.pid}.tmp`;
    writeFileSync(temp, text);
    renameSync(temp, file);
    this.size += bytes - oldBytes;
  }
  async request(url: string): Promise<Response> {
    const host = new URL(url).hostname;
    if (!["kaikki.org", "api.tatoeba.org"].includes(host) || !url.startsWith("https://")) throw new Error("Unapproved factual source endpoint");
    for (let attempt = 0; attempt < 2; attempt++) {
      const delay = Math.max(0, this.nextRequestAt - Date.now());
      this.nextRequestAt = Date.now() + delay + 1100;
      await new Promise(r => setTimeout(r, delay));
      try {
        const response = await fetch(url, { signal: AbortSignal.timeout(25000), redirect: "error", headers: { "User-Agent": "NGSLVocabularyRecovery/1.0 (+https://github.com/Real-Etix/English-Learning-Website-NGSL)" } });
        if (response.ok || response.status === 404) return response;
        await response.body?.cancel();
        if (attempt === 0 && (response.status === 429 || response.status >= 500)) {
          const retry = Number(response.headers.get("retry-after") ?? "2");
          if (Number.isFinite(retry) && retry <= 60) {
            this.nextRequestAt = Math.max(this.nextRequestAt, Date.now() + Math.max(2, retry) * 1000);
            continue;
          }
        }
        throw new Error(`Source HTTP ${response.status}`);
      } catch (e) {
        // Do not retry explicit denials or exceed a server's Retry-After policy.
        if (attempt || (e instanceof Error && e.message.startsWith("Source HTTP"))) throw e;
      }
    }
    throw new Error("Source request failed");
  }
  async englishEntries(lemma: string): Promise<unknown[]> {
    const key = `english-wiktextract-v2:${lemma}`;
    const old = await this.load(key);
    if (old !== null) { if (!Array.isArray(old)) throw new Error("Invalid cached entries"); return old; }
    const chars = Array.from(lemma);
    if (!/^[\p{L}\p{N}]/u.test(lemma)) return [];
    const segments = [chars[0]!, chars.slice(0, 2).join(""), `${lemma}.jsonl`].map(encodeURIComponent);
    const response = await this.request(`https://kaikki.org/dictionary/English/meaning/${segments.join("/")}`);
    if (response.status === 404) { await response.body?.cancel(); await this.save(key, []); return []; }
    const text = await readBounded(response, 2 * 1024 * 1024);
    const entries = text.trim().split("\n").filter(Boolean).map(line => JSON.parse(line));
    await this.save(key, entries);
    return entries;
  }
  async loadSimpleCandidates(lemmas: string[]): Promise<Record<string, unknown[]>> {
    const key = `simple-wiktextract-v2:${digest([...lemmas].sort().join("\n"))}`;
    const old = await this.load(key);
    if (old !== null) {
      if (typeof old !== "object" || Array.isArray(old)) throw new Error("Invalid simple dictionary cache");
      return old as Record<string, unknown[]>;
    }
    const response = await this.request("https://kaikki.org/dictionary/downloads/simple/simple-extract.jsonl.gz");
    if (!response.ok) throw new Error("Simple dictionary is unavailable");
    const compressed = await boundedBytes(response, 8 * 1024 * 1024);
    const text = gunzipSync(compressed, { maxOutputLength: 64 * 1024 * 1024 }).toString("utf8");
    const wanted = new Set(lemmas);
    const result: Record<string, unknown[]> = Object.create(null);
    for (const line of text.split("\n")) {
      if (!line) continue;
      const entry = JSON.parse(line);
      if (wanted.has(entry.word) && entry.lang_code === "en") (result[entry.word] ??= []).push(entry);
    }
    await this.save(key, result);
    return result;
  }
  async tatoebaExamples(lemma: string, forms: string[]): Promise<VocabularySense["examples"]> {
    const key = `attributed-tatoeba-exact-v3:${lemma}`;
    let payload = await this.load(key);
    if (payload === null) {
      // Tatoeba stems plain queries: listener matches listen. '=' disables stemming.
      const query = `="${lemma.replace(/["\\]/g, " ")}"`;
      const response = await this.request(`https://api.tatoeba.org/v1/sentences?lang=eng&q=${encodeURIComponent(query)}&sort=relevance`);
      if (!response.ok) throw new Error("Tatoeba lookup unavailable");
      payload = JSON.parse(await readBounded(response, 1024 * 1024));
      await this.save(key, payload);
    }
    return attributableTatoeba(payload, lemma, forms, new Date().toISOString());
  }
}
export async function acquireRecoveryLock(root: string): Promise<() => Promise<void>> {
  mkdirSync(root, { recursive: true });
  const file = path.join(root, "worker.lock");
  try {
    const handle = await open(file, "wx");
    await handle.writeFile(String(process.pid));
    await handle.close();
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e;
    const pid = Number(await readFile(file, "utf8"));
    if (!Number.isSafeInteger(pid) || pid < 1) throw new Error("Invalid worker lock");
    try { process.kill(pid, 0); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error;
      await unlink(file);
      return acquireRecoveryLock(root);
    }
    throw new Error(`Recovery worker ${pid} is active`);
  }
  return async () => { if (await readFile(file, "utf8") !== String(process.pid)) throw new Error("Worker lock changed"); await unlink(file); };
}

export function attributableTatoeba(raw: unknown, lemma: string, forms: string[], stamp: string): VocabularySense["examples"] {
  if (!raw || typeof raw !== "object" || !Array.isArray((raw as { data?: unknown }).data)) throw new Error("Invalid Tatoeba response");
  const rows = (raw as { data: unknown[] }).data;
  return rows.flatMap(value => {
    if (!value || typeof value !== "object" || Array.isArray(value)) return [];
    const row = value as Record<string, unknown>;
    const author = row.owner ?? (row.user as { username?: unknown } | null)?.username;
    const license = row.license;
    const licenseUrl = license === "CC BY 2.0 FR" ? "https://creativecommons.org/licenses/by/2.0/fr/" : license === "CC0 1.0" ? "https://creativecommons.org/publicdomain/zero/1.0/" : null;
    if (row.is_unapproved === true || !Number.isSafeInteger(row.id) || row.lang !== "eng" || typeof row.text !== "string" || typeof author !== "string" || !author.trim() || !licenseUrl) return [];
    if (!containsVocabularyForm(row.text, { lemma, forms })) return [];
    return [{ text: row.text, sources: [{ sourceId: "tatoeba", externalId: String(row.id), url: `https://tatoeba.org/en/sentences/show/${row.id}`, retrievedAt: stamp,
      contentHash: `sha256:${digest(JSON.stringify(row))}`, attribution: author, license: String(license), licenseUrl }] }];
  });
}
