import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  loadGeneratedWord: vi.fn(),
  rateLimit: vi.fn(),
  clientIp: vi.fn(),
}));

vi.mock("@/lib/vocabulary/generated-word-store", () => ({ loadGeneratedWord: mocks.loadGeneratedWord }));
vi.mock("@/lib/rate-limit", () => ({ rateLimit: mocks.rateLimit, clientIp: mocks.clientIp }));

import { vocabularyRecordFixture } from "@/lib/vocabulary/test-fixtures";
import type { VocabularyRecord } from "@/lib/vocabulary/schema";
import { POST } from "./route";

function request(body: unknown) {
  return new Request("http://localhost/api/compose", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function records(): { target: VocabularyRecord; partner: VocabularyRecord } {
  const source = vocabularyRecordFixture();
  const target = {
    ...source,
    lemma: "bank",
    display: "bank",
    senses: [
      { ...source.senses[0]!, id: "bank:money", definition: "a financial institution", status: "published" as const },
      { ...source.senses[0]!, id: "bank:tilt", definition: "to tilt while turning", status: "published" as const },
    ],
    connections: [{ ...source.connections[0]!, target: "turn", type: "antonym" as const, gloss: "Show the contrast.", status: "published" as const }],
  };
  const partner = {
    ...source,
    lemma: "turn",
    display: "turn",
    senses: [
      { ...source.senses[0]!, id: "turn:draft", definition: "a draft turn definition", status: "draft" as const },
      { ...source.senses[0]!, id: "turn:published", definition: "to change direction", status: "published" as const },
    ],
  };
  return { target, partner };
}

describe("POST /api/compose", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.rateLimit.mockReturnValue({ ok: true, remaining: 19, retryAfterSec: 0 });
    mocks.clientIp.mockReturnValue("test-client");
    const { target, partner } = records();
    mocks.loadGeneratedWord.mockImplementation((lemma: string) => Promise.resolve(lemma === "bank" ? target : lemma === "turn" ? partner : null));
  });

  it("rejects a supplied sense that does not belong to the target lemma", async () => {
    const response = await POST(request({ action: "task", lemma: "bank", senseId: "turn:published" }));

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "That meaning does not belong to this word." });
  });

  it("rejects a hidden supplied sense instead of falling back", async () => {
    const { target, partner } = records();
    target.senses[1] = { ...target.senses[1]!, status: "hidden" };
    mocks.loadGeneratedWord.mockImplementation((lemma: string) => Promise.resolve(lemma === "bank" ? target : lemma === "turn" ? partner : null));

    const response = await POST(request({ action: "task", lemma: "bank", senseId: "bank:tilt" }));

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: "This meaning is not published yet." });
  });

  it("uses selected published target and partner senses for the task definitions", async () => {
    const response = await POST(request({ action: "task", lemma: "bank", senseId: "bank:tilt", claimed: [], avoid: [] }));

    expect(response.status).toBe(200);
    expect((await response.json()).task).toMatchObject({
      partner: "turn",
      defs: ["to tilt while turning", "to change direction"],
    });
    expect(mocks.rateLimit).toHaveBeenCalledWith("compose:test-client", 20, 60_000);
  });
});
