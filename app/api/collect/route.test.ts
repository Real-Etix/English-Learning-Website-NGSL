import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  cookies: vi.fn(),
  collectWord: vi.fn(),
  getMySummary: vi.fn(),
  hasCollectedWord: vi.fn(),
  loadGeneratedWord: vi.fn(),
  canonicalGet: vi.fn(),
  newOwnerToken: vi.fn(),
}));

vi.mock("next/headers", () => ({ cookies: mocks.cookies }));
vi.mock("@/lib/collection/service", () => ({
  collectWord: mocks.collectWord,
  getMySummary: mocks.getMySummary,
  hasCollectedWord: mocks.hasCollectedWord,
  newOwnerToken: mocks.newOwnerToken,
}));
vi.mock("@/lib/vocabulary/generated-word-store", () => ({ loadGeneratedWord: mocks.loadGeneratedWord }));
vi.mock("@/lib/vocabulary/ndjson-repository", () => ({
  openNdjsonRepository: () => ({ get: mocks.canonicalGet }),
}));

import { vocabularyRecordFixture } from "@/lib/vocabulary/test-fixtures";
import type { VocabularyRecord } from "@/lib/vocabulary/schema";
import { POST } from "./route";

const senseId = "bank:wordnet:1";

function claimableRecord(): VocabularyRecord {
  const record = vocabularyRecordFixture();
  return {
    ...record,
    lemma: "bank",
    display: "bank",
    senses: [{
      ...record.senses[0]!,
      id: senseId,
      status: "published" as const,
    }],
  };
}

function recordWithSense(overrides: Partial<VocabularyRecord["senses"][number]>): VocabularyRecord {
  const record = claimableRecord();
  return {
    ...record,
    senses: [{ ...record.senses[0]!, ...overrides }],
  };
}

function request(body: unknown) {
  return new Request("http://localhost/api/collect", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/collect", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.cookies.mockResolvedValue({ get: () => ({ value: "owner-1" }) });
    mocks.loadGeneratedWord.mockResolvedValue(claimableRecord());
    mocks.canonicalGet.mockResolvedValue(undefined);
    mocks.hasCollectedWord.mockResolvedValue(false);
    mocks.collectWord.mockResolvedValue({ added: true, xp: 10, display: "bank" });
    mocks.getMySummary.mockResolvedValue({ lemmas: ["bank"], summary: "held" });
  });

  it("rejects a lemma-only request before collection mutation", async () => {
    const response = await POST(request({ lemma: "bank" }));

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "missing senseId" });
    expect(mocks.collectWord).not.toHaveBeenCalled();
  });

  it("collects only after the canonical selected sense is ready", async () => {
    const response = await POST(request({ lemma: "bank", senseId }));

    expect(response.status).toBe(200);
    expect(mocks.collectWord).toHaveBeenCalledWith("owner-1", "bank", senseId);
  });

  it("returns 409 for a hidden canonical record instead of reporting it unknown", async () => {
    mocks.loadGeneratedWord.mockResolvedValue(null);
    mocks.canonicalGet.mockResolvedValue({ ...claimableRecord(), publicationStatus: "hidden" });

    const response = await POST(request({ lemma: "bank", senseId }));

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: "This word is not available to claim." });
    expect(mocks.collectWord).not.toHaveBeenCalled();
    expect(mocks.newOwnerToken).not.toHaveBeenCalled();
    expect(mocks.canonicalGet).toHaveBeenCalledWith("bank");
  });

  it("keeps an unknown lemma at 404", async () => {
    mocks.loadGeneratedWord.mockResolvedValue(null);
    mocks.canonicalGet.mockResolvedValue(undefined);

    const response = await POST(request({ lemma: "not-in-corpus", senseId }));

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "unknown word" });
    expect(mocks.collectWord).not.toHaveBeenCalled();
  });

  it.each([
    ["wrong sense", { senseId: "bank:wordnet:2" }, "That meaning does not belong to this word."],
    ["draft sense", { record: recordWithSense({ status: "draft" }) }, "This meaning is not published yet."],
    ["AI-only sense", { record: recordWithSense({ sources: [{ sourceId: "llm", externalId: null, url: null, retrievedAt: null, contentHash: null }], examples: [{ text: "AI draft example.", sources: [{ sourceId: "llm", externalId: null, url: null, retrievedAt: null, contentHash: null }] }] }) }, "This meaning needs a trustworthy source before it can be claimed."],
    ["missing example", { record: recordWithSense({ examples: [] }) }, "This meaning needs a sourced example before it can be claimed."],
  ])("returns 409 and does not mutate for a %s", async (_label, options, reason) => {
    if ("record" in options) mocks.loadGeneratedWord.mockResolvedValue(options.record);
    const response = await POST(request({ lemma: "bank", senseId: "senseId" in options ? options.senseId : senseId }));

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: reason });
    expect(mocks.collectWord).not.toHaveBeenCalled();
  });

  it("returns an already-collected word before readiness, preserving its history", async () => {
    mocks.loadGeneratedWord.mockResolvedValue(null);
    mocks.canonicalGet.mockResolvedValue({
      ...claimableRecord(),
      publicationStatus: "hidden",
      senses: [recordWithSense({ status: "draft" }).senses[0]!],
    });
    mocks.hasCollectedWord.mockResolvedValue(true);
    mocks.getMySummary.mockResolvedValue({ slug: "space", lemmas: ["bank"] });

    const response = await POST(request({ lemma: "bank" }));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      added: false,
      xp: 0,
      display: "bank",
      summary: { slug: "space", lemmas: ["bank"] },
    });
    expect(mocks.collectWord).not.toHaveBeenCalled();
    expect(mocks.hasCollectedWord).toHaveBeenCalledWith("owner-1", "bank");
  });
});
