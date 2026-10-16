import type { LearningSense } from "@/lib/content/word-learning";

export type ClaimQuizPrompt = {
  kind: "type" | "word"; lemma: string; senseId: string; prompt: string;
  sentence?: string; answer: string; options?: { id: string; text: string }[];
};

export function buildClaimQuiz(
  lemma: string, display: string,
  sense: Pick<LearningSense, "id" | "definition" | "example" | "canClaim">,
  siblings: readonly { lemma: string; display: string }[], random: () => number,
): ClaimQuizPrompt | null {
  if (!sense.canClaim) return null;
  const common = { lemma, senseId: sense.id };
  const example = sense.example;
  if (example && display && example.toLowerCase().includes(display.toLowerCase())) {
    const literal = display.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return { ...common, kind: "type", prompt: "Which word is missing?", sentence: example.replace(new RegExp(literal, "i"), "———"), answer: display };
  }
  const others = [...new Map(siblings.filter(word => word.lemma !== lemma && word.display.toLowerCase() !== display.toLowerCase())
    .map(word => [word.display.toLowerCase(), word])).values()];
  const shuffle = <T,>(items: T[]) => {
    for (let i = items.length - 1; i > 0; i--) {
      const j = Math.floor(random() * (i + 1));
      [items[i], items[j]] = [items[j], items[i]];
    }
    return items;
  };
  const prompt = `${sense.definition} — which word is it?`;
  if (others.length < 2) return { ...common, kind: "type", prompt, answer: display };
  const options = shuffle(others).slice(0, 3).map(word => ({ id: word.lemma, text: word.display }));
  options.push({ id: lemma, text: display });
  return { ...common, kind: "word", prompt, answer: lemma, options: shuffle(options) };
}
