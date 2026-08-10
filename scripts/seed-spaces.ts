/**
 * Seed a few curated public spaces so there's something to explore before there's
 * a user base (the cold-start problem). Idempotent — re-run to refresh.
 *
 * Usage: tsx scripts/seed-spaces.ts
 */
import "dotenv/config";

import { wordXp } from "../lib/collection/xp";
import { prisma } from "../lib/db";
import { readAllPages, type WikiPage } from "../lib/wiki/parse-wiki";

type SpaceSpec = {
  slug: string;
  displayName: string;
  count: number;
  pick: (p: WikiPage) => boolean;
};

const SPACES: SpaceSpec[] = [
  { slug: "wall-street", displayName: "Wall Street", count: 45, pick: (p) => p.lists.includes("business") },
  { slug: "gym-rat", displayName: "Gym Rat", count: 40, pick: (p) => p.lists.includes("fitness") },
  { slug: "exam-crusher", displayName: "Exam Crusher", count: 45, pick: (p) => p.lists.includes("academic") },
  { slug: "word-nerd", displayName: "Word Nerd", count: 55, pick: (p) => p.tier === "advanced" },
];

async function main() {
  const pages = await readAllPages();

  for (const spec of SPACES) {
    // Prefer connected words so the space's galaxy has visible structure.
    const pool = pages.filter((p) => spec.pick(p) && p.connections.length > 0);
    const chosen = pool.slice(0, spec.count);

    const collection = await prisma.collection.upsert({
      where: { slug: spec.slug },
      update: { displayName: spec.displayName },
      create: { slug: spec.slug, ownerToken: `seed:${spec.slug}`, displayName: spec.displayName },
    });

    // Reset words so the seed is idempotent.
    await prisma.collectedWord.deleteMany({ where: { collectionId: collection.id } });
    await prisma.collectedWord.createMany({
      data: chosen.map((p) => ({
        collectionId: collection.id,
        lemma: p.lemma,
        xp: wordXp({ tier: p.tier, sfi: p.sfi }),
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
