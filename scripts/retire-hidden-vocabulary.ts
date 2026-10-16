/** One explicitly approved, offline migration. Dry-run by default; recoverable. */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { openNdjsonRepository } from "../lib/vocabulary/ndjson-repository";
import { planRetirement, type RetirementDecision, type RetiredIncomingConnection } from "../lib/vocabulary/retirement";
import { releaseRecordHash } from "../lib/vocabulary/limited-release";
import { VocabularyRecordSchema, type VocabularyRecord } from "../lib/vocabulary/schema";
import { shardIdForLemma } from "../lib/vocabulary/shards";
import { acquireRecoveryLock } from "../lib/vocabulary/verification/recovery-io";
import { lintVocabularyRecords } from "./lint-vocabulary";

const archiveRoot = "content/vocabulary-retired/2026-10-16";
const archiveFile = `${archiveRoot}/archive.json`;
const metadataPaths = ["content/vocabulary/editorial-decisions.json", "content/vocabulary/limited-example-release.json", "content/vocabulary/manifest.json"] as const;
const hash = (text: string) => createHash("sha256").update(text).digest("hex");
const json = async (file: string) => JSON.parse(await readFile(file, "utf8"));
type Queue = { entries?: Record<string, unknown>; withheld?: Record<string, string>; [key: string]: unknown };
type Archive = {
  version: 1; reviewedAt: string; decisions: RetirementDecision[];
  retired: VocabularyRecord[]; incoming: RetiredIncomingConnection[];
  beforeHashes: Record<string, string>; afterHashes: Record<string, string>;
  metadata: Record<string, string>; spendHash: string;
};
async function readOptionalArchive(): Promise<Archive | null> {
  try { return await json(archiveFile); }
  catch (e) { if ((e as NodeJS.ErrnoException).code === "ENOENT") return null; throw e; }
}
async function atomic(file: string, text: string) {
  const temp = `${file}.tmp-${process.pid}`;
  await writeFile(temp, text);
  await rename(temp, file);
}
async function main() {
  const args = process.argv.slice(2);
  assert(args.length === 0 || (args.length === 1 && args[0] === "--write"), "Usage: retire-hidden-vocabulary.ts [--write]");
  const write = args.includes("--write");
  const unlock = await acquireRecoveryLock(path.resolve(".cache/vocabulary-repair"));
  try {
    const current: VocabularyRecord[] = [];
    for await (const r of openNdjsonRepository().all()) current.push(r);
    const prior = await readOptionalArchive();
    const batch = await json("content/vocabulary/final-review-batches/002.json");
    const decisions: RetirementDecision[] = batch.decisions.map((d: RetirementDecision & { hold: boolean }) => {
      assert.equal(d.hold, true); return { lemma:d.lemma, beforeHash:d.beforeHash, reason:d.reason };
    });
    const spendHash = hash(await readFile(".cache/vocabulary-repair/spend.json", "utf8"));
    assert.equal(spendHash, (await json(".cache/vocabulary-repair/final-review/baseline.json")).spend, "Spending changed since final review started");
    const shardInputs = new Map<string,string>();
    for (let i=0;i<32;i++) {
      const file=`content/vocabulary/${i.toString(16).padStart(2,"0")}.ndjson`;
      const text=await readFile(file,"utf8");
      const disk=text.trim().split("\n").filter(Boolean).map(line=>VocabularyRecordSchema.parse(JSON.parse(line)));
      const expected=current.filter(r=>shardIdForLemma(r.lemma)===path.basename(file,".ndjson"));
      assert.deepEqual(disk,expected,`Concurrent shard edit: ${file}`);
      shardInputs.set(file,text);
    }
    let original = current;
    if (prior) {
      assert.deepEqual(prior.decisions, decisions, "Retirement decisions changed");
      assert.equal(prior.spendHash, spendHash, "Spending changed during retirement");
      const by = new Map(current.map(r=>[r.lemma,r]));
      for (const r of prior.retired) {
        if (by.has(r.lemma)) assert.equal(releaseRecordHash(by.get(r.lemma)!), prior.beforeHashes[r.lemma]);
        else by.set(r.lemma, VocabularyRecordSchema.parse(r));
      }
      for (const [id, record] of by) {
        const digest = releaseRecordHash(record);
        if (digest === prior.beforeHashes[id]) continue;
        assert.equal(digest, prior.afterHashes[id], `Concurrent change: ${id}`);
        const connections = [...record.connections];
        for (const edge of prior.incoming.filter(e=>e.lemma===id).sort((a,b)=>a.index-b.index)) connections.splice(edge.index,0,edge.connection);
        const restored = {...record,connections};
        assert.equal(releaseRecordHash(restored),prior.beforeHashes[id]); by.set(id,restored);
      }
      assert.equal(by.size,Object.keys(prior.beforeHashes).length,"Unexpected added/missing records");
      original=[...by.values()];
    }
    const plan = planRetirement(original, decisions);
    assert.equal(lintVocabularyRecords(plan.retained).length,0,"Retirement would leave broken relationships");
    assert(plan.retained.every(r=>r.publicationStatus === "published"),"Unexpected hidden/review backlog remains");
    const existing = new Map(current.map(r=>[r.lemma,releaseRecordHash(r)]));
    const changed = plan.retained.filter(r=>existing.get(r.lemma)!==releaseRecordHash(r)).length + plan.retired.filter(r=>existing.has(r.lemma)).length;
    const archive: Archive = prior ?? {
      version:1,reviewedAt:batch.reviewedAt,decisions,retired:plan.retired,incoming:plan.incoming,
      beforeHashes:Object.fromEntries(original.map(r=>[r.lemma,releaseRecordHash(r)])),
      afterHashes:Object.fromEntries(plan.retained.map(r=>[r.lemma,releaseRecordHash(r)])),
      metadata:Object.fromEntries(await Promise.all(metadataPaths.map(async p=>[p,await readFile(p,"utf8")]))),spendHash,
    };
    const nextFiles = new Map<string,string>();
    for(let i=0;i<32;i++) {
      const id=i.toString(16).padStart(2,"0");
      nextFiles.set(`content/vocabulary/${id}.ndjson`,plan.retained.filter(r=>shardIdForLemma(r.lemma)===id).sort((a,b)=>a.lemma<b.lemma?-1:a.lemma>b.lemma?1:0).map(r=>JSON.stringify(r)+"\n").join(""));
    }
    for(const file of metadataPaths.slice(0,2)) {
      const queue:Queue = JSON.parse(archive.metadata[file]);
      for(const d of decisions) { if(queue.entries) delete queue.entries[d.lemma]; if(queue.withheld) delete queue.withheld[d.lemma]; }
      nextFiles.set(file,JSON.stringify(queue,null,2)+"\n");
    }
    const factual = new Set((await json("content/vocabulary/sources.json")).sources.filter((s:{factual:boolean})=>s.factual).map((s:{id:string})=>s.id));
    const manifest = {
      schemaVersion:1,generatedFrom:"content/vocabulary",totals:{records:plan.retained.length,
        connections:plan.retained.reduce((n,r)=>n+r.connections.length,0),
        perList:Object.fromEntries(["academic","business","fitness","ngsl","toeic"].map(id=>[id,plan.retained.filter(r=>r.lists.some(l=>l.id===id)).length])),
        publication:{draft:0,review:0,published:plan.retained.length,hidden:0},
        sourceBacked:plan.retained.filter(r=>[...r.sources,...r.senses.flatMap(s=>s.sources)].some(s=>factual.has(s.sourceId))).length},
      shards:Object.fromEntries([...nextFiles].filter(([p])=>p.endsWith(".ndjson")).map(([p,text])=>[path.basename(p,".ndjson"),{records:text.trim()?text.trimEnd().split("\n").length:0,bytes:Buffer.byteLength(text),sha256:hash(text)}])),
    };
    nextFiles.set(metadataPaths[2],JSON.stringify(manifest,null,2)+"\n");
    // Validate every destination before any canonical write. A prior archive is
    // the only authority for resuming after a known partial migration.
    for(const file of metadataPaths) {
      const text=await readFile(file,"utf8");
      assert(text===archive.metadata[file] || text===nextFiles.get(file),`Concurrent metadata change: ${file}`);
    }
    if(write) {
      await mkdir(archiveRoot,{recursive:true});
      if(!prior) {
        const text=JSON.stringify(archive)+"\n";
        await writeFile(archiveFile,text,{flag:"wx"});
        assert.equal(hash(await readFile(archiveFile,"utf8")),hash(text),"Archive verification failed");
      }
      for(const [file,text] of shardInputs) assert.equal(await readFile(file,"utf8"),text,`Concurrent shard edit: ${file}`);
      for(const [file,text] of nextFiles) if(await readFile(file,"utf8")!==text) await atomic(file,text);
      await atomic(`${archiveRoot}/receipt.json`,JSON.stringify({version:1,reviewedAt:archive.reviewedAt,retired:plan.retired.length,incomingRemoved:plan.incoming.length,activeRecords:plan.retained.length,archiveSha256:hash(await readFile(archiveFile,"utf8")),paidCalls:0},null,2)+"\n");
    }
    console.log(JSON.stringify({mode:write?"write":"dry-run",retired:plan.retired.length,incomingRemoved:plan.incoming.length,activeRecords:plan.retained.length,changedRecords:changed,paidCalls:0}));
  } finally { await unlock(); }
}
void main().catch(e=>{console.error(e instanceof Error?e.message:e);process.exitCode=1;});
