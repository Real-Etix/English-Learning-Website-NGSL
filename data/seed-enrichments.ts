import { sourceCredits } from "@/lib/content/source-credits";
import type { WordEnrichment } from "@/lib/types";

export type ManualWordEnrichment = Omit<
  WordEnrichment,
  "sourceCredits" | "contentStatus"
>;

export const defaultEnrichment = (lemma: string): WordEnrichment => ({
  definition: `Source-backed enrichment is not available yet for "${lemma}". Review the pronunciation, forms, and list context first.`,
  partOfSpeech: "unknown",
  exampleSentences: [],
  relatedPhrases: [],
  phrasalVerbs: [],
  conversationPrompt: `Use "${lemma}" in a short sentence after you review its sourced definition and examples.`,
  sourceCredits: [sourceCredits.fallback],
  contentStatus: "fallback",
});

export const manualWordEnrichments: Record<string, ManualWordEnrichment> = {
  client: {
    definition: "a customer or person who receives professional services",
    partOfSpeech: "noun",
    exampleSentences: [
      {
        id: "client-1",
        text: "The client asked for the proposal before Friday afternoon.",
        explanation: "This shows the word in a realistic office request.",
        source: "curated",
      },
      {
        id: "client-2",
        text: "She prepared a short update so the client would know the project status.",
        explanation: "The sentence links client with project communication.",
        source: "curated",
      },
    ],
    relatedPhrases: ["client meeting", "client request", "client feedback"],
    phrasalVerbs: ["follow up with"],
    conversationPrompt:
      'Use "client" in a polite office conversation between a manager and a customer.',
  },
  analysis: {
    definition: "a careful study of something in order to understand it",
    partOfSpeech: "noun",
    exampleSentences: [
      {
        id: "analysis-1",
        text: "The report includes a brief analysis of the survey results.",
        explanation: "This is a common academic and business use of analysis.",
        source: "curated",
      },
      {
        id: "analysis-2",
        text: "Her analysis helped the class understand why the data changed.",
        explanation: "The sentence ties analysis to explanation and reasoning.",
        source: "curated",
      },
    ],
    relatedPhrases: ["data analysis", "market analysis", "close analysis"],
    phrasalVerbs: ["break down"],
    conversationPrompt:
      'Use "analysis" in an academic discussion where two students talk through evidence.',
  },
  protein: {
    definition: "a nutrient that helps the body build and repair tissue",
    partOfSpeech: "noun",
    exampleSentences: [
      {
        id: "protein-1",
        text: "After the workout, he chose a snack with more protein.",
        explanation: "This is a natural fitness and nutrition context.",
        source: "curated",
      },
      {
        id: "protein-2",
        text: "The coach explained why protein matters during recovery.",
        explanation: "The sentence connects protein with coaching language.",
        source: "curated",
      },
    ],
    relatedPhrases: ["protein intake", "protein shake", "lean protein"],
    phrasalVerbs: ["work out"],
    conversationPrompt:
      'Use "protein" in a short gym conversation about meals and recovery.',
  },
  goal: {
    definition: "something you want to achieve",
    partOfSpeech: "noun",
    exampleSentences: [
      {
        id: "goal-1",
        text: "Set one small goal for today and one bigger goal for this month.",
        explanation: "The sentence highlights practical planning language.",
        source: "curated",
      },
      {
        id: "goal-2",
        text: "Her study goal is to learn twenty new words this week.",
        explanation: "This ties goal directly to language learning.",
        source: "curated",
      },
    ],
    relatedPhrases: ["reach a goal", "set a goal", "goal setting"],
    phrasalVerbs: ["work toward"],
    conversationPrompt:
      'Use "goal" in a motivating conversation about short-term and long-term plans.',
  },
  budget: {
    definition: "a plan for how money will be spent",
    partOfSpeech: "noun",
    exampleSentences: [
      {
        id: "budget-1",
        text: "The team reviewed the budget before approving the campaign.",
        explanation: "This example fits workplace planning language.",
        source: "curated",
      },
      {
        id: "budget-2",
        text: "A tight budget forced the group to choose the simplest option.",
        explanation: "This shows budget in a decision-making context.",
        source: "curated",
      },
    ],
    relatedPhrases: ["stay within budget", "budget review", "budget plan"],
    phrasalVerbs: ["cut back"],
    conversationPrompt:
      'Use "budget" in a business conversation where a team negotiates limited spending.',
  },
  recover: {
    definition: "to become healthy, normal, or strong again after difficulty",
    partOfSpeech: "verb",
    exampleSentences: [
      {
        id: "recover-1",
        text: "Athletes need time to recover after intense training sessions.",
        explanation: "The sentence fits wellness and sports recovery language.",
        source: "curated",
      },
      {
        id: "recover-2",
        text: "She took a rest day so her body could recover properly.",
        explanation: "This reinforces recover in a fitness routine.",
        source: "curated",
      },
    ],
    relatedPhrases: ["recover fully", "recovery day", "muscle recovery"],
    phrasalVerbs: ["bounce back"],
    conversationPrompt:
      'Use "recover" in a coaching conversation about training hard and healing well.',
  },
};
