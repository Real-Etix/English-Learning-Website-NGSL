import { describe, expect, it, vi } from "vitest";

import { vocabularyRecordFixture } from "../vocabulary/test-fixtures";

const mocks = vi.hoisted(() => ({
  get: vi.fn(),
  readPage: vi.fn(),
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

vi.mock("@/lib/wiki/parse-wiki", () => ({ readPage: mocks.readPage }));

import { collectWord } from "./service";

describe("collectWord", () => {
  it("collects a canonical-only word using the NDJSON repository", async () => {
    mocks.get.mockResolvedValue({
      ...vocabularyRecordFixture(),
      lemma: "canonical-only",
      display: "Canonical only",
      tier: "advanced",
      lists: [],
    });
    mocks.readPage.mockResolvedValue(null);
    mocks.collectionFindUnique.mockResolvedValue({ id: "collection-1" });
    mocks.collectedWordCreate.mockResolvedValue({ id: "word-1" });

    await expect(collectWord("owner-1", "canonical-only")).resolves.toEqual({
      added: true,
      xp: 40,
      display: "Canonical only",
    });
    expect(mocks.get).toHaveBeenCalledWith("canonical-only");
    expect(mocks.readPage).not.toHaveBeenCalled();
  });
});
