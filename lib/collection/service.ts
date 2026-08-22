import { randomUUID } from "node:crypto";

import { prisma } from "@/lib/db";
import { badgesFor, levelForXp, wordXp } from "@/lib/collection/xp";
import { loadListGraph } from "@/lib/wiki/graph-store";
import { openNdjsonRepository } from "@/lib/vocabulary/ndjson-repository";

/** Which collected lemmas are advanced-tier in the canonical vocabulary corpus. */
async function countAdvanced(lemmas: string[]): Promise<number> {
  const wanted = new Set(lemmas);
  const advanced = new Set<string>();
  for await (const record of openNdjsonRepository().all()) {
    if (record.tier === "advanced" && wanted.has(record.lemma)) advanced.add(record.lemma);
  }
  return lemmas.filter((l) => advanced.has(l)).length;
}

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
  const record = await openNdjsonRepository().get(lemma);
  if (!record) return { added: false, error: "unknown word" as const };

  const collection = await getOrCreateCollection(ownerToken);
  const xp = wordXp({ tier: record.tier, sfi: record.lists[0]?.sfi ?? null });
  try {
    await prisma.collectedWord.create({
      data: { collectionId: collection.id, lemma, xp, source: "collected" },
    });
    return { added: true, xp, display: record.display };
  } catch {
    return { added: false, xp: 0, display: record.display }; // already collected (unique constraint)
  }
}

export type CollectionSummary = {
  slug: string;
  displayName: string | null;
  lemmas: string[];
  usedLemmas: string[]; // solid stars — produced in a sentence within the decay window
  decayedCount: number; // solid stars that have since gone hollow
  wordCount: number;
  totalXp: number;
  level: number;
  badges: ReturnType<typeof badgesFor>;
};

/** A word stays "solid" for this many days after it was last used in a sentence. */
export const DECAY_DAYS = 60;

function summarize(
  collection: { slug: string; displayName: string | null },
  words: { lemma: string; xp: number; usedAt?: Date | null }[],
  advancedCount: number,
  spacesVisited = 0,
): CollectionSummary {
  const totalXp = words.reduce((sum, w) => sum + w.xp, 0);
  const cutoff = Date.now() - DECAY_DAYS * 864e5;
  const usedLemmas: string[] = [];
  let decayedCount = 0;
  for (const w of words) {
    if (!w.usedAt) continue;
    if (new Date(w.usedAt).getTime() >= cutoff) usedLemmas.push(w.lemma);
    else decayedCount += 1;
  }
  return {
    slug: collection.slug,
    displayName: collection.displayName,
    lemmas: words.map((w) => w.lemma),
    usedLemmas,
    decayedCount,
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
    include: { words: { select: { lemma: true, xp: true, usedAt: true } } },
  });
  if (!collection) return null;
  const advancedCount = await countAdvanced(collection.words.map((w) => w.lemma));
  return summarize(collection, collection.words, advancedCount);
}

/** Mark a held word as produced-in-a-sentence (solid star). One-time XP bonus, refreshes the decay clock. */
export async function markWordUsed(ownerToken: string, lemma: string): Promise<{ error: string } | { used: true; bonus: number; summary: CollectionSummary | null }> {
  const collection = await prisma.collection.findUnique({ where: { ownerToken }, select: { id: true } });
  if (!collection) return { error: "no collection" };
  const cw = await prisma.collectedWord.findUnique({
    where: { collectionId_lemma: { collectionId: collection.id, lemma } },
    select: { id: true, xp: true, usedAt: true },
  });
  if (!cw) return { error: "not collected" };
  const bonus = cw.usedAt == null ? Math.max(8, Math.round(cw.xp * 0.6)) : 0; // only the first time
  await prisma.collectedWord.update({
    where: { id: cw.id },
    data: { usedAt: new Date(), xp: cw.xp + bonus },
  });
  const summary = await getMySummary(ownerToken);
  return { used: true, bonus, summary };
}

/** A public space by its share slug. */
export async function getSpaceBySlug(slug: string): Promise<CollectionSummary | null> {
  const collection = await prisma.collection.findUnique({
    where: { slug },
    include: { words: { select: { lemma: true, xp: true, usedAt: true } } },
  });
  if (!collection) return null;
  const advancedCount = await countAdvanced(collection.words.map((w) => w.lemma));
  return summarize(collection, collection.words, advancedCount);
}

/** Does a collection exist for this token? (used to validate a pasted recovery key) */
export async function tokenHasCollection(token: string): Promise<boolean> {
  if (!token) return false;
  const c = await prisma.collection.findUnique({ where: { ownerToken: token }, select: { id: true } });
  return c !== null;
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

// --- Phase 2: rarity + leaderboard ---

export type WordRarity = { owners: number; explorers: number; percent: number };

/** How rare a word is: how many explorers (non-empty spaces) have collected it. */
export async function getWordRarity(lemma: string): Promise<WordRarity> {
  const [owners, explorers] = await Promise.all([
    prisma.collectedWord.count({ where: { lemma } }),
    prisma.collection.count({ where: { words: { some: {} } } }),
  ]);
  const percent = explorers > 0 ? Math.round((owners / explorers) * 100) : 0;
  return { owners, explorers, percent };
}

export type LeaderboardEntry = {
  rank: number;
  slug: string;
  displayName: string | null;
  wordCount: number;
  totalXp: number;
  level: number;
};

/** Public spaces ranked by total XP (only spaces with at least one word). */
export async function getLeaderboard(limit = 20): Promise<LeaderboardEntry[]> {
  const collections = await prisma.collection.findMany({
    where: { words: { some: {} } },
    include: { words: { select: { xp: true } } },
  });
  return collections
    .map((c) => {
      const totalXp = c.words.reduce((sum, w) => sum + w.xp, 0);
      return {
        slug: c.slug,
        displayName: c.displayName,
        wordCount: c.words.length,
        totalXp,
        level: levelForXp(totalXp),
      };
    })
    .sort((a, b) => b.totalXp - a.totalXp || b.wordCount - a.wordCount)
    .slice(0, limit)
    .map((entry, i) => ({ rank: i + 1, ...entry }));
}
