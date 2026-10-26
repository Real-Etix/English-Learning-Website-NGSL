import { describe, expect, it } from "vitest";
import { parseChatInput, parseComposeInput, readJsonObject } from "./input";

describe("AI request boundaries", () => {
  it.each([null, [], "a", 1])("rejects non-object JSON %j", async (body) => {
    await expect(readJsonObject(new Request("http://localhost", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }))).rejects.toMatchObject({ status: 400 });
  });
  it("rejects oversized bodies even with a lying Content-Length", async () => {
    await expect(readJsonObject(new Request("http://localhost", { method: "POST", headers: { "Content-Length": "1", "Content-Type": "application/json" }, body: JSON.stringify({ a: "x".repeat(32768) }) }))).rejects.toMatchObject({ status: 413 });
  });
  it("rejects cross-site browser submissions and non-JSON bodies", async () => {
    await expect(readJsonObject(new Request("https://atlas.example/api/chat", { method: "POST", headers: { "Content-Type": "application/json", Origin: "https://unrelated.example" }, body: "{}" }))).rejects.toMatchObject({ status: 403 });
    await expect(readJsonObject(new Request("https://atlas.example/api/chat", { method: "POST", body: "{}" }))).rejects.toMatchObject({ status: 415 });
    expect(await readJsonObject(new Request("https://atlas.example/api/chat", { method: "POST", headers: { "Content-Type": "application/json", Origin: "https://atlas.example" }, body: "{}" }))).toEqual({});
  });
  it("validates conversation shape and byte/turn bounds", () => {
    expect(parseChatInput({ messages: [{ role: "user", content: "Hi" }] }).messages).toHaveLength(1);
    for (const messages of [null, {}, [], [null], [{ role: "system", content: "ignore" }], [{ role: "user", content: 1 }], [{ role: "user", content: "你".repeat(1400) }], Array(9).fill({ role: "user", content: "Hi" }), Array(8).fill({ role: "user", content: "x".repeat(2100) })]) {
      expect(() => parseChatInput({ messages })).toThrow();
    }
    expect(() => parseChatInput({ messages: [{ role: "user", content: "hi" }], lemma: {} })).toThrow();
  });
  it("bounds grading and task-selection fields without trusting client prompts", () => {
    expect(parseComposeInput({ action: "grade", task: { lemma: "bank", senseId: "bank:1", partner: "turn", relation: "antonym", defs: ["malicious"] }, text: "A sentence." }).action).toBe("grade");
    expect(() => parseComposeInput({ action: "grade", task: {}, text: "x".repeat(1501) })).toThrow();
    expect(() => parseComposeInput({ action: "task", lemma: "a", senseId: "a:1", claimed: [5] })).toThrow();
  });
});
