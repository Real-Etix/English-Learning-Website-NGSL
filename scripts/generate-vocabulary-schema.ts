import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { VocabularyRecordSchema } from "../lib/vocabulary/schema";

async function main(): Promise<void> {
  const out = process.argv.find((argument) => argument.startsWith("--out="))?.slice("--out=".length) ?? "content/vocabulary/schema.json";
  const file = path.resolve(out);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, `${JSON.stringify(VocabularyRecordSchema.toJSONSchema(), null, 2)}\n`, "utf8");
  console.log(`Wrote ${file}`);
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
