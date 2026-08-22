import { isFactualSourceId } from "../vocabulary/source-evidence";
import type { VocabularyRecord, VocabularySense } from "../vocabulary/schema";
import type { WordLearningProfile } from "./word-learning";

const ANTI_FABRICATION_INSTRUCTION = "Do not invent missing usage guidance or relationships.";

function hasFactualSource(sources: { sourceId: string }[]): boolean {
  return sources.some((source) => isFactualSourceId(source.sourceId));
}

function publishedGuidance(sense: VocabularySense): string[] {
  return [
    ...sense.usagePatterns
      .filter((pattern) => pattern.status === "published" && hasFactualSource(pattern.sources))
      .map((pattern) => `Pattern: ${pattern.pattern} — ${pattern.explanation}`),
    ...sense.collocations
      .filter((collocation) => collocation.status === "published" && hasFactualSource(collocation.sources))
      .map((collocation) => `Collocation: ${collocation.phrase}${collocation.explanation ? ` — ${collocation.explanation}` : ""}`),
    ...sense.commonMistakes
      .filter((mistake) => mistake.status === "published" && hasFactualSource(mistake.sources))
      .map((mistake) => `Common mistake: ${mistake.incorrect} → ${mistake.correction} — ${mistake.explanation}`),
  ].slice(0, 6);
}

/** Builds a bounded tutor reference for one exact, published canonical sense. */
export function buildTutorSenseContext(record: VocabularyRecord, senseId: string): string | null {
  if (record.publicationStatus !== "published") return null;
  const sense = record.senses.find((candidate) => candidate.id === senseId);
  if (!sense || sense.status !== "published") return null;

  const lines = [
    "Open word reference:",
    `Word: ${record.display}`,
    `Lemma: ${record.lemma}`,
    `Part of speech: ${sense.partOfSpeech}`,
    `Tier: ${record.tier}`,
    "Selected meaning:",
    `- ${sense.definition}`,
  ];
  const examples = sense.examples.filter((example) => hasFactualSource(example.sources)).slice(0, 3);
  if (examples.length > 0) {
    lines.push("Sourced examples:");
    for (const example of examples) lines.push(`- ${example.text}`);
  }
  const guidance = publishedGuidance(sense);
  if (guidance.length > 0) {
    lines.push("Published usage guidance:");
    for (const item of guidance) lines.push(`- ${item}`);
  }
  const connections = record.connections
    .filter((connection) => connection.status === "published" && Boolean(connection.gloss?.trim()))
    .slice(0, 12);
  if (connections.length > 0) {
    lines.push("Authored connection explanations:");
    for (const connection of connections) lines.push(`- ${connection.type} → ${connection.target} — ${connection.gloss}`);
  }

  lines.push(ANTI_FABRICATION_INSTRUCTION);
  return lines.join("\n");
}

export function buildTutorStarContext(profile: WordLearningProfile): string {
  const senses = profile.senses.slice(0, 4);
  const primary = senses.find((sense) => sense.primary) ?? senses[0];
  const additional = senses.filter((sense) => sense !== primary);
  const lines = [
    "Open word reference:",
    `Word: ${profile.display}`,
    `Lemma: ${profile.lemma}`,
    `Part of speech: ${profile.partOfSpeech}`,
    `Tier: ${profile.tier}`,
    `Evidence: ${profile.evidenceLabel}`,
  ];

  if (profile.sources.length > 0) lines.push(`Sources: ${profile.sources.join(", ")}`);
  if (primary) {
    lines.push("Primary meaning:", `- (${primary.source}) ${primary.definition}`);
  }
  if (additional.length > 0) {
    lines.push("Additional meanings:");
    for (const sense of additional) lines.push(`- (${sense.source}) ${sense.definition}`);
  }
  if (profile.examples.length > 0) {
    lines.push("Sourced examples:");
    for (const example of profile.examples.slice(0, 3)) {
      lines.push(`- (${example.source}) ${example.text}`);
    }
  }
  if (profile.usageNote) lines.push("Usage note:", profile.usageNote);

  const explainedConnections = profile.connections.filter((connection) => connection.explained).slice(0, 12);
  if (explainedConnections.length > 0) {
    lines.push("Authored connection explanations:");
    for (const connection of explainedConnections) {
      lines.push(`- ${connection.type} → ${connection.target} — ${connection.gloss ?? ""}`);
    }
  }

  lines.push(ANTI_FABRICATION_INSTRUCTION);
  return lines.join("\n");
}
