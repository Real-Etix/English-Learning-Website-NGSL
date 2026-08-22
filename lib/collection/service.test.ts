import { describe, expect, it, vi } from "vitest";

import { vocabularyRecordFixture } from "../vocabulary/test-fixtures";

const mocks = vi.hoisted(() => ({
  get: vi.fn(),
  collectionFindUnique: vi.fn(),
  collectedWordCreate: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    collection: { findUnique: mocks.collectionFindUnique },
    collectedWord: { create: mocks.collectedWordCreate },
  },
}));

vi.mock("@/lib/vocabulary/ndjson-repository", () => ({
  openNdjsonRepository: () => ({ get: mocks.get }),
}));

import { collectWord } from "./service";

describe("collectWord", () => {
  it("does not mutate a collection when no selected sense is supplied", async () => {
    mocks.get.mockResolvedValue(vocabularyRecordFixture());

    await expect(collectWord("owner-1", "learn")).resolves.toEqual({
      added: false,
      error: "not claimable",
      reason: "Choose a meaning before claiming this word.",
    });
    expect(mocks.collectionFindUnique).not.toHaveBeenCalled();
    expect(mocks.collectedWordCreate).not.toHaveBeenCalled();
  });

  it("collects a canonical-only word using the NDJSON repository", async () => {
    mocks.get.mockResolvedValue({
      ...vocabularyRecordFixture(),
      lemma: "canonical-only",
      display: "Canonical only",
      tier: "advanced",
      lists: [],
    });
    mocks.collectionFindUnique.mockResolvedValue({ id: "collection-1" });
    mocks.collectedWordCreate.mockResolvedValue({ id: "word-1" });

    await expect(collectWord("owner-1", "canonical-only", "learn-verb-1")).resolves.toEqual({
      added: true,
      xp: 40,
      display: "Canonical only",
    });
    expect(mocks.get).toHaveBeenCalledWith("canonical-only");
  });
});
