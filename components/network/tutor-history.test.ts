import { expect, it } from "vitest";
import { tutorHistory } from "./tutor-history";
it("sends only whole recent messages within the server's byte and turn limits", () => {
  const log = Array.from({ length: 10 }, (_, n) => ({ role: "user" as const, text: `message ${n}` }));
  expect(tutorHistory(log)).toHaveLength(8);
  expect(tutorHistory(log)[0].content).toBe("message 2");
  const large = Array.from({ length: 8 }, () => ({ role: "user" as const, text: "你".repeat(1000) }));
  expect(tutorHistory(large)).toHaveLength(5);
  expect(tutorHistory([...log, { role: "assistant", text: "x".repeat(5000) }, { role: "user", text: "latest" }])).toEqual([{ role: "user", content: "latest" }]);
});
