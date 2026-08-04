import { randomUUID } from "node:crypto";

import { prisma } from "@/lib/db";
import { badgesFor, levelForXp, wordXp } from "@/lib/collection/xp";
import { readPage } from "@/lib/wiki/parse-wiki";

const ADJ = ["brave", "calm", "bright", "swift", "lucky", "cosmic", "astral", "stellar", "quiet", "bold", "keen", "wild"];
const ANIMAL = ["otter", "falcon", "lynx", "koala", "heron", "fox", "orca", "raven", "ibis", "wolf", "moth", "crane"];

const pick = <T>(a: T[]) => a[Math.floor(Math.random() * a.length)];
const randomSlug = () => `${pick(ADJ)}-${pick(ANIMAL)}-${Math.floor(Math.random() * 1000)}`;

export function newOwnerToken() {
  return randomUUID();
}

/** Get the caller's collection (by cookie token), creating it on first use. */
export async function getOrCreateCollection(ownerToken: string) {
  const existing = await prisma.collection.findUnique({ where: { ownerToken } });
  if (existing) return existing;
  // Retry a few times in the rare event of a slug collision.
  for (let i = 0; i < 5; i += 1) {
    try {
      return await prisma.collection.create({ data: { ownerToken, slug: randomSlug() } });
    } catch {
      /* unique slug clash — try another */
    }
  }
  throw new Error("could not allocate a collection slug");
}

/** Add a word to the caller's collection. Returns whether it was newly added + xp gained. */
export async function collectWord(ownerToken: string, lemma: string) {
  const page = await readPage(lemma);
  if (!page) return { added: false, error: "unknown word" as const };

  const collection = await getOrCreateCollection(ownerToken);
  const xp = wordXp({ tier: page.tier, rank: page.rank });
  try {
    await prisma.collectedWord.create({
      data: { collectionId: collection.id, lemma, xp, source: "collected" },
    });
    return { added: true, xp, display: page.display };
  } catch {
    return { added: false, xp: 0, display: page.display }; // already collected (unique constraint)
  }
}

export type CollectionSummary = {
  slug: string;
  displayName: string | null;
  lemmas: string[];
  wordCount: number;
  totalXp: number;
  level: number;
  badges: ReturnType<typeof badgesFor>;
};

function summarize(
  collection: { slug: string; displayName: string | null },
  words: { lemma: string; xp: number }[],
  spacesVisited = 0,
): CollectionSummary {
  const totalXp = words.reduce((sum, w) => sum + w.xp, 0);
  // Advanced words score >=25 (base 25 +); core words top out at 22 — a reliable split.
  const advancedCount = words.filter((w) => w.xp >= 25).length;
  return {
    slug: collection.slug,
    displayName: collection.displayName,
    lemmas: words.map((w) => w.lemma),
    wordCount: words.length,
    totalXp,
    level: levelForXp(totalXp),
    badges: badgesFor({ wordCount: words.length, advancedCount, spacesVisited }),
  };
}

/** The caller's own collection summary (or null if they have none yet). */
export async function getMySummary(ownerToken: string | undefined): Promise<CollectionSummary | null> {
  if (!ownerToken) return null;
  const collection = await prisma.collection.findUnique({
    where: { ownerToken },
    include: { words: { select: { lemma: true, xp: true } } },
  });
  if (!collection) return null;
  return summarize(collection, collection.words);
}

/** A public space by its share slug. */
export async function getSpaceBySlug(slug: string): Promise<CollectionSummary | null> {
  const collection = await prisma.collection.findUnique({
    where: { slug },
    include: { words: { select: { lemma: true, xp: true } } },
  });
  if (!collection) return null;
  return summarize(collection, collection.words);
}

export async function renameCollection(ownerToken: string, displayName: string) {
  const name = displayName.trim().slice(0, 40);
  await prisma.collection.update({
    where: { ownerToken },
    data: { displayName: name || null },
  });
}

/** Empty a collection (keeps the space + share slug, removes all collected words). */
export async function resetCollection(ownerToken: string) {
  const collection = await prisma.collection.findUnique({ where: { ownerToken } });
  if (!collection) return;
  await prisma.collectedWord.deleteMany({ where: { collectionId: collection.id } });
}
