import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  completeChat: vi.fn(),
  getListVocab: vi.fn(),
  hasLLM: vi.fn(),
  loadGeneratedWord: vi.fn(),
  rateLimit: vi.fn(),
  clientIp: vi.fn(),
}));

vi.mock("@/lib/ai/runtime", async (original) => ({ ...await original<typeof import("@/lib/ai/runtime")>(), runtimeChat: mocks.completeChat }));
// Keep legacy transport inert while this route is being migrated; never load dotenv/keys.
vi.mock("@/scripts/llm-client", () => ({ completeChat: vi.fn(async () => null), hasLLM: () => true }));
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
    connections: [
      { ...source.connections[0]!, target: "study", gloss: "  Known authored connection.  ", status: "published" as const },
      { ...source.connections[0]!, target: "missing", gloss: "Missing authored connection.", status: "published" as const },
      { ...source.connections[0]!, target: "hidden", gloss: "Hidden authored connection.", status: "published" as const },
    ],
  };
}

function targetRecord(lemma: string, publicationStatus: VocabularyRecord["publicationStatus"] = "published"): VocabularyRecord {
  const source = vocabularyRecordFixture();
  return { ...source, lemma, display: lemma, publicationStatus };
}

describe("POST /api/chat", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.hasLLM.mockReturnValue(true);
    mocks.rateLimit.mockReturnValue({ ok: true, remaining: 14, retryAfterSec: 0 });
    mocks.clientIp.mockReturnValue("test-client");
    mocks.getListVocab.mockResolvedValue({ ngsl: { title: "NGSL", words: ["bank"] } });
    const word = record();
    mocks.loadGeneratedWord.mockImplementation((lemma: string) => Promise.resolve(
      lemma === "bank" ? word : lemma === "study" ? targetRecord("study") : lemma === "hidden" ? targetRecord("hidden", "hidden") : null,
    ));
    mocks.completeChat.mockResolvedValue({ ok: true, text: "grounded reply" });
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

  it("keeps the front-door limit and grounds bounded history in the selected sense", async () => {
    const messages = Array.from({ length: 8 }, (_, index) => ({
      role: index % 2 ? "assistant" as const : "user" as const,
      content: `message ${index + 1}`,
    }));

    const response = await POST(request({ messages, listSlug: "ngsl", lemma: "bank", senseId: "bank:tilt" }));

    expect(response.status).toBe(200);
    expect(mocks.rateLimit).toHaveBeenCalledWith("chat:test-client", 15, 60_000);
    const sent = mocks.completeChat.mock.calls[0]![1];
    expect(sent).toHaveLength(9);
    expect(sent[0].content).toContain("to tilt while turning");
    expect(sent[0].content).not.toContain("a financial institution");
    expect(sent[0].content).toContain("  Known authored connection.  ");
    expect(sent[0].content).not.toContain("Missing authored connection.");
    expect(sent[0].content).not.toContain("Hidden authored connection.");
    expect(mocks.loadGeneratedWord).toHaveBeenCalledWith("study");
    expect(mocks.loadGeneratedWord).toHaveBeenCalledWith("missing");
    expect(mocks.loadGeneratedWord).toHaveBeenCalledWith("hidden");
    expect(sent[1].content).toBe("message 1");

    mocks.rateLimit.mockReturnValue({ ok: false, remaining: 0, retryAfterSec: 9 });
    const blocked = await POST(request({ messages: [{ role: "user", content: "Again" }] }));
    expect(blocked.status).toBe(429);
    expect(mocks.completeChat).toHaveBeenCalledTimes(1);
  });

  it("uses the first published sense only when senseId is omitted", async () => {
    const word = record();
    word.senses[0] = { ...word.senses[0]!, status: "hidden" };
    mocks.loadGeneratedWord.mockImplementation((lemma: string) => Promise.resolve(
      lemma === "bank" ? word : lemma === "study" ? targetRecord("study") : lemma === "hidden" ? targetRecord("hidden", "hidden") : null,
    ));

    const response = await POST(request({ messages: [{ role: "user", content: "What is it?" }], lemma: "bank" }));

    expect(response.status).toBe(200);
    expect(mocks.completeChat.mock.calls[0]![1][0].content).toContain("to tilt while turning");
    expect(mocks.completeChat.mock.calls[0]![1][0].content).not.toContain("a financial institution");
  });

  it.each([null, 42, {}, "", "   "]) ("rejects an explicitly malformed senseId (%j) without calling the LLM", async (senseId) => {
    const response = await POST(request({ messages: [{ role: "user", content: "Help" }], lemma: "bank", senseId }));

    expect(response.status).toBe(400);
    expect(mocks.completeChat).not.toHaveBeenCalled();
  });

  it("rejects an LLM-only selected definition", async () => {
    const llmOnly = record();
    llmOnly.senses[1] = {
      ...llmOnly.senses[1]!,
      sources: [{ ...llmOnly.senses[1]!.sources[0]!, sourceId: "llm" }],
    };
    mocks.loadGeneratedWord.mockImplementation((lemma: string) => Promise.resolve(lemma === "bank" ? llmOnly : null));

    const response = await POST(request({ messages: [{ role: "user", content: "Help" }], lemma: "bank", senseId: "bank:tilt" }));

    expect(response.status).toBe(409);
    expect(mocks.completeChat).not.toHaveBeenCalled();
  });

  it.each([null, [], { messages: {} }, { messages: [null] }, { messages: Array(9).fill({ role: "user", content: "hi" }) }])("rejects malformed input without paid dispatch %j", async body => {
    expect((await POST(request(body))).status).toBe(400);
    expect(mocks.completeChat).not.toHaveBeenCalled();
  });
  it("returns shared-budget refusal and reset time", async () => {
    mocks.completeChat.mockResolvedValue({ ok: false, status: 429, error: "Daily AI allowance reached.", retryAfter: 120 });
    const response = await POST(request({ messages: [{ role: "user", content: "hello" }] }));
    expect(response.status).toBe(429);
    expect(response.headers.get("Retry-After")).toBe("120");
  });
});
