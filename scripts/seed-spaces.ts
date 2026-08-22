/**
 * Seed a few curated public spaces so there's something to explore before there's
 * a user base (the cold-start problem). Idempotent — re-run to refresh.
 *
 * Usage: tsx scripts/seed-spaces.ts
 */
import "dotenv/config";

import { wordXp } from "../lib/collection/xp";
import { prisma } from "../lib/db";
import { openNdjsonRepository } from "../lib/vocabulary/ndjson-repository";
import type { VocabularyRecord } from "../lib/vocabulary/schema";

type SpaceSpec = {
  slug: string;
  displayName: string;
  count: number;
  pick: (record: VocabularyRecord) => boolean;
};

const SPACES: SpaceSpec[] = [
  { slug: "wall-street", displayName: "Wall Street", count: 45, pick: (record) => record.lists.some((membership) => membership.id === "business") },
  { slug: "gym-rat", displayName: "Gym Rat", count: 40, pick: (record) => record.lists.some((membership) => membership.id === "fitness") },
  { slug: "exam-crusher", displayName: "Exam Crusher", count: 45, pick: (record) => record.lists.some((membership) => membership.id === "academic") },
  { slug: "word-nerd", displayName: "Word Nerd", count: 55, pick: (record) => record.tier === "advanced" },
];

async function main() {
  const records: VocabularyRecord[] = [];
  for await (const record of openNdjsonRepository().all()) records.push(record);

  for (const spec of SPACES) {
    // Prefer connected words so the space's galaxy has visible structure.
    const pool = records.filter((record) => spec.pick(record) && record.connections.length > 0);
    const chosen = pool.slice(0, spec.count);

    const collection = await prisma.collection.upsert({
      where: { slug: spec.slug },
      update: { displayName: spec.displayName },
      create: { slug: spec.slug, ownerToken: `seed:${spec.slug}`, displayName: spec.displayName },
    });

    // Reset words so the seed is idempotent.
    await prisma.collectedWord.deleteMany({ where: { collectionId: collection.id } });
    await prisma.collectedWord.createMany({
      data: chosen.map((record) => ({
        collectionId: collection.id,
        lemma: record.lemma,
        xp: wordXp({ tier: record.tier, sfi: record.lists[0]?.sfi ?? null }),
        source: "seed",
      })),
      skipDuplicates: true,
    });

    console.log(`  /g/${spec.slug.padEnd(14)} — ${chosen.length} words (${spec.displayName})`);
  }
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (error) => {
    console.error(error);
    await prisma.$disconnect();
    process.exitCode = 1;
  });
