import type { WordLearningProfile } from "./word-learning";

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

  lines.push("Do not invent missing usage guidance or relationships.");
  return lines.join("\n");
}
