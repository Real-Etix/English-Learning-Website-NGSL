import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { z } from "zod";

// Peak CNY prices, deliberately ignoring cache discounts and off-peak savings.
// https://api-docs.deepseek.com/zh-cn/quick_start/pricing/
const entrySchema = z.object({
  maximum: z.number().int().nonnegative(), charged: z.number().int().nonnegative(),
  status: z.enum(["reserved", "complete"]), value: z.unknown().optional(),
});
const ledgerSchema = z.object({
  version: z.literal(1), ceiling: z.number().int().positive().max(16_000_000),
  entries: z.record(z.string(), entrySchema),
});
type Entry = z.infer<typeof entrySchema>;

/** UTF-8 bytes upper-bound tokenized text; reserve extra chat-template overhead. */
export function worstCaseMicroCny(prompt: string, maxOutputTokens: number): number {
  if (!Number.isSafeInteger(maxOutputTokens) || maxOutputTokens < 1) throw new Error("Invalid output limit");
  return (Buffer.byteLength(prompt, "utf8") + 1024) * 2 + maxOutputTokens * 8;
}

/** Single-worker, synchronous atomic ledger: no await between checking and reserving. */
export class SpendLedger {
  private state: z.infer<typeof ledgerSchema>;
  constructor(private readonly path: string, ceilingCny = 16) {
    const ceiling = Math.floor(ceilingCny * 1_000_000);
    this.state = existsSync(path)
      ? ledgerSchema.parse(JSON.parse(readFileSync(path, "utf8")))
      : ledgerSchema.parse({ version: 1, ceiling, entries: {} });
    if (this.state.ceiling !== ceiling) throw new Error("Do not change the saved spending ceiling on resume");
    this.save();
  }
  private save() {
    mkdirSync(dirname(this.path), { recursive: true });
    const temp = `${this.path}.${process.pid}.tmp`;
    writeFileSync(temp, JSON.stringify(this.state));
    renameSync(temp, this.path);
  }
  get chargedMicroCny() { return Object.values(this.state.entries).reduce((sum, e) => sum + e.charged, 0); }
  entry(key: string): Readonly<Entry> | undefined { return this.state.entries[key]; }
  reserve(key: string, maximum: number): boolean {
    if (!Number.isSafeInteger(maximum) || maximum < 0) throw new Error("Invalid spending reservation");
    if (Object.hasOwn(this.state.entries, key) || this.chargedMicroCny + maximum > this.state.ceiling) return false;
    this.state.entries[key] = { maximum, charged: maximum, status: "reserved" };
    this.save(); // Must succeed before the caller may send the request.
    return true;
  }
  finish(key: string, usage: { inputTokens: number; outputTokens: number } | null, value: unknown) {
    const entry = this.state.entries[key];
    if (!entry || entry.status !== "reserved") throw new Error("Missing or already settled reservation");
    const valid = usage && [usage.inputTokens, usage.outputTokens].every(n => Number.isSafeInteger(n) && n >= 0);
    // Missing usage, including timeouts and invalid JSON, is charged at the reserved maximum.
    const charged = valid ? usage.inputTokens * 2 + usage.outputTokens * 8 : entry.maximum;
    this.state.entries[key] = { ...entry, status: "complete", charged, value };
    this.save();
    if (charged > entry.maximum) throw new Error("Provider exceeded its spending reservation; stop paid calls");
  }
}
