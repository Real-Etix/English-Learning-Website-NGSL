import type { LearningWord } from "@/lib/types";

export function normalizeAnswer(input: string) {
  return input
    .trim()
    .toLowerCase()
    .replace(/[^\w\s'-]/g, "")
    .replace(/\s+/g, " ");
}

export function answersMatch(input: string, acceptedForms: string[]) {
  const normalizedInput = normalizeAnswer(input);
  const normalizedForms = acceptedForms.map(normalizeAnswer);

  if (normalizedForms.includes(normalizedInput)) {
    return true;
  }

  return normalizedForms.some((form) =>
    Math.abs(form.length - normalizedInput.length) <= 1 &&
    (form.startsWith(normalizedInput) || normalizedInput.startsWith(form)),
  );
}

function waitForVoices() {
  if (typeof window === "undefined" || typeof window.speechSynthesis === "undefined") {
    return Promise.resolve<SpeechSynthesisVoice[]>([]);
  }

  const existingVoices = window.speechSynthesis.getVoices();
  if (existingVoices.length > 0) {
    return Promise.resolve(existingVoices);
  }

  return new Promise<SpeechSynthesisVoice[]>((resolve) => {
    const handleVoicesChanged = () => {
      resolve(window.speechSynthesis.getVoices());
      window.speechSynthesis.removeEventListener("voiceschanged", handleVoicesChanged);
    };

    window.speechSynthesis.addEventListener("voiceschanged", handleVoicesChanged);
    window.setTimeout(() => {
      resolve(window.speechSynthesis.getVoices());
      window.speechSynthesis.removeEventListener("voiceschanged", handleVoicesChanged);
    }, 1200);
  });
}

function pickEnglishVoice(voices: SpeechSynthesisVoice[]) {
  return (
    voices.find((voice) => voice.lang === "en-US") ??
    voices.find((voice) => voice.lang.startsWith("en-")) ??
    voices.find((voice) => voice.lang.startsWith("en"))
  );
}

export async function speakWord(word: string) {
  if (typeof window === "undefined" || typeof window.speechSynthesis === "undefined") {
    return {
      ok: false,
      sourceLabel: "No browser speech engine available",
    };
  }

  const voices = await waitForVoices();
  const voice = pickEnglishVoice(voices);
  const utterance = new SpeechSynthesisUtterance(word);
  utterance.lang = voice?.lang ?? "en-US";
  utterance.voice = voice ?? null;
  utterance.rate = 0.92;
  utterance.pitch = 1;

  return new Promise<{ ok: boolean; sourceLabel: string }>((resolve) => {
    utterance.onend = () =>
      resolve({
        ok: true,
        sourceLabel: voice ? `Browser voice: ${voice.name}` : "Browser speech fallback",
      });
    utterance.onerror = () =>
      resolve({
        ok: false,
        sourceLabel: "Browser speech could not play",
      });

    window.speechSynthesis.cancel();
    window.speechSynthesis.resume();
    window.speechSynthesis.speak(utterance);
    window.setTimeout(() => window.speechSynthesis.resume(), 150);
  });
}

export function buildConversationLines(word: LearningWord) {
  const primaryExample = word.exampleSentences[0]?.text;
  const prompt = word.conversationPrompt.replace(/^Use\s+"?/, "").replace(/\.$/, "");

  return [
    `A: I want to use "${word.lemma}" correctly. What does it mean here?`,
    `B: It means ${word.definition}${primaryExample ? `, like in: ${primaryExample}` : "."}`,
    `A: Great. I will practise it in a short dialogue by trying to ${prompt.toLowerCase()}.`,
  ];
}

export function buildPracticePack(word: LearningWord, topic: string, level: string) {
  const sentences = word.exampleSentences.map((sentence) => sentence.text);
  const phraseSummary =
    word.relatedPhrases.length > 0
      ? word.relatedPhrases.slice(0, 2).join(" and ")
      : `the idea of ${word.lemma}`;

  return {
    title: `${word.lemma} for ${topic}`,
    sentences,
    paragraph: `At ${level} level, "${word.lemma}" means ${word.definition}. Connect it to ${topic}, read the source-backed examples carefully, and notice phrase patterns such as ${phraseSummary}.`,
    conversation: buildConversationLines(word),
    usageTip: `Focus on how "${word.lemma}" appears with nearby words and examples from trusted fixed sources.`,
    fromModel: false,
  };
}

export async function lookupPronunciationAudio(word: string) {
  try {
    const response = await fetch(`/api/pronunciation/${encodeURIComponent(word)}`);
    if (!response.ok) {
      return null;
    }

    const payload = (await response.json()) as {
      audioUrl: string | null;
      sourceLabel: string | null;
    };

    if (!payload.audioUrl) {
      return null;
    }

    return payload;
  } catch {
    return null;
  }

}
