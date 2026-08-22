import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  completeChat: vi.fn(),
  getListVocab: vi.fn(),
  hasLLM: vi.fn(),
  loadGeneratedWord: vi.fn(),
  rateLimit: vi.fn(),
  clientIp: vi.fn(),
}));

vi.mock("@/scripts/llm-client", () => ({
  completeChat: mocks.completeChat,
  hasLLM: mocks.hasLLM,
}));
vi.mock("@/lib/content/list-vocab", () => ({
  getListVocab: mocks.getListVocab,
  sampleWords: (words: string[]) => words,
}));
vi.mock("@/lib/vocabulary/generated-word-store", () => ({ loadGeneratedWord: mocks.loadGeneratedWord }));
vi.mock("@/lib/rate-limit", () => ({ rateLimit: mocks.rateLimit, clientIp: mocks.clientIp }));

import { vocabularyRecordFixture } from "@/lib/vocabulary/test-fixtures";
import type { VocabularyRecord } from "@/lib/vocabulary/schema";
import { POST } from "./route";

function request(body: unknown) {
  return new Request("http://localhost/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function record(): VocabularyRecord {
  const source = vocabularyRecordFixture();
  return {
    ...source,
    lemma: "bank",
    display: "bank",
    senses: [
      { ...source.senses[0]!, id: "bank:money", definition: "a financial institution", status: "published" as const },
      { ...source.senses[0]!, id: "bank:tilt", definition: "to tilt while turning", status: "published" as const },
    ],
  };
}

describe("POST /api/chat", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.hasLLM.mockReturnValue(true);
    mocks.rateLimit.mockReturnValue({ ok: true, remaining: 14, retryAfterSec: 0 });
    mocks.clientIp.mockReturnValue("test-client");
    mocks.getListVocab.mockResolvedValue({ ngsl: { title: "NGSL", words: ["bank"] } });
    mocks.loadGeneratedWord.mockResolvedValue(record());
    mocks.completeChat.mockResolvedValue("grounded reply");
  });

  it("rejects a supplied sense that does not belong to the requested lemma", async () => {
    const response = await POST(request({ messages: [{ role: "user", content: "Help" }], lemma: "bank", senseId: "other:sense" }));

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "That meaning does not belong to this word." });
    expect(mocks.completeChat).not.toHaveBeenCalled();
  });

  it("rejects a hidden supplied sense instead of grounding in another meaning", async () => {
    const hidden = record();
    hidden.senses[1] = { ...hidden.senses[1]!, status: "hidden" };
    mocks.loadGeneratedWord.mockResolvedValue(hidden);

    const response = await POST(request({ messages: [{ role: "user", content: "Help" }], lemma: "bank", senseId: "bank:tilt" }));

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: "This meaning is not published yet." });
    expect(mocks.completeChat).not.toHaveBeenCalled();
  });

  it("keeps the rate limit and truncates history while grounding in the selected sense", async () => {
    const messages = Array.from({ length: 10 }, (_, index) => ({
      role: index % 2 ? "assistant" as const : "user" as const,
      content: `message ${index + 1}`,
    }));

    const response = await POST(request({ messages, listSlug: "ngsl", lemma: "bank", senseId: "bank:tilt" }));

    expect(response.status).toBe(200);
    expect(mocks.rateLimit).toHaveBeenCalledWith("chat:test-client", 15, 60_000);
    const sent = mocks.completeChat.mock.calls[0]![0];
    expect(sent).toHaveLength(9);
    expect(sent[0].content).toContain("to tilt while turning");
    expect(sent[0].content).not.toContain("a financial institution");
    expect(sent[1].content).toBe("message 3");

    mocks.rateLimit.mockReturnValue({ ok: false, remaining: 0, retryAfterSec: 9 });
    const blocked = await POST(request({ messages: [{ role: "user", content: "Again" }] }));
    expect(blocked.status).toBe(429);
    expect(mocks.completeChat).toHaveBeenCalledTimes(1);
  });
});
