import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  cookies: vi.fn(),
  collectWord: vi.fn(),
  getMySummary: vi.fn(),
  loadGeneratedWord: vi.fn(),
  newOwnerToken: vi.fn(),
}));

vi.mock("next/headers", () => ({ cookies: mocks.cookies }));
vi.mock("@/lib/collection/service", () => ({
  collectWord: mocks.collectWord,
  getMySummary: mocks.getMySummary,
  newOwnerToken: mocks.newOwnerToken,
}));
vi.mock("@/lib/vocabulary/generated-word-store", () => ({ loadGeneratedWord: mocks.loadGeneratedWord }));

import { vocabularyRecordFixture } from "@/lib/vocabulary/test-fixtures";
import { POST } from "./route";

const senseId = "bank:wordnet:1";

function claimableRecord() {
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
    mocks.collectWord.mockResolvedValue({ added: true, xp: 10, display: "bank" });
    mocks.getMySummary.mockResolvedValue({ lemmas: ["bank"] });
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
});
