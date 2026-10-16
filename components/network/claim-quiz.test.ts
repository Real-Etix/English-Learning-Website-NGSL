import { describe, expect, it } from "vitest";
import { buildClaimQuiz } from "./claim-quiz";

const sense = { id: "test", definition: "a unit of length", example: null, canClaim: true };
describe("buildClaimQuiz", () => {
  it("uses a meaning question without an example and with no resident neighbours", () => {
    expect(buildClaimQuiz("metre", "metre", sense, [], () => .5)).toMatchObject({ kind: "type", answer: "metre", prompt: expect.stringContaining("unit of length") });
  });
  it("uses distinct word choices when at least two distractors exist", () => {
    const quiz = buildClaimQuiz("metre", "metre", sense, [{ lemma: "time", display: "time" }, { lemma: "mass", display: "mass" }, { lemma: "mass", display: "mass" }], () => .5);
    expect(quiz?.kind).toBe("word");
    expect(quiz?.options).toHaveLength(3);
  });
  it("blocks unclaimable senses", () => {
    expect(buildClaimQuiz("metre", "metre", { ...sense, canClaim: false }, [], Math.random)).toBeNull();
  });
  it("treats the display literally when constructing an example gap", () => {
    expect(buildClaimQuiz("a+b", "a+b", { ...sense, example: "We use a+b here." }, [], Math.random)?.sentence).toBe("We use ——— here.");
  });
});
