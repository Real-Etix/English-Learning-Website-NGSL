import type { LearningConnection, LearningExample, LearningSense, WordLearningProfile } from "@/lib/content/word-learning";

export const CONNECTION_LABELS: Record<string, string> = {
  advanced_form: "Level up to",
  builds_on: "Builds on",
  synonym: "Means about the same",
  antonym: "Means the opposite",
  intensity: "Stronger / weaker",
  collocation: "Goes with",
  morphological: "Word family",
};

export const CONNECTION_ORDER = [
  "advanced_form",
  "builds_on",
  "intensity",
  "synonym",
  "antonym",
  "morphological",
  "collocation",
];

export type DrawerConnectionGroup = {
  type: string;
  label: string;
  items: LearningConnection[];
};

export type WordLearningDrawerModel = {
  primarySense: LearningSense | null;
  otherSenses: LearningSense[];
  examples: LearningExample[];
  explainedGroups: DrawerConnectionGroup[];
  unreviewedGroups: DrawerConnectionGroup[];
  unreviewedCount: number;
  audio: {
    uk: string | null;
    us: string | null;
    any: string | null;
    available: boolean;
  };
};

function groupConnections(connections: LearningConnection[]): DrawerConnectionGroup[] {
  const grouped = new Map<string, LearningConnection[]>();
  for (const connection of connections) {
    const items = grouped.get(connection.type) ?? [];
    items.push(connection);
    grouped.set(connection.type, items);
  }

  const types = [...CONNECTION_ORDER, ...grouped.keys()].filter(
    (type, index, values) => grouped.has(type) && values.indexOf(type) === index,
  );

  return types.map((type) => ({
    type,
    label: CONNECTION_LABELS[type] ?? type,
    items: grouped.get(type) ?? [],
  }));
}

export function buildWordLearningDrawerModel(profile: WordLearningProfile): WordLearningDrawerModel {
  const primarySense = profile.senses.find((sense) => sense.primary) ?? profile.senses[0] ?? null;
  const otherSenses = profile.senses.filter((sense) => sense !== primarySense).slice(0, 5);
  const explained = profile.connections.filter((connection) => connection.explained);
  const unreviewed = profile.connections.filter((connection) => !connection.explained);
  const { audioUk: uk, audioUs: us, audioAny: any } = profile.pronunciation;

  return {
    primarySense,
    otherSenses,
    examples: profile.examples,
    explainedGroups: groupConnections(explained),
    unreviewedGroups: groupConnections(unreviewed),
    unreviewedCount: unreviewed.length,
    audio: { uk, us, any, available: Boolean(uk || us || any) },
  };
}
