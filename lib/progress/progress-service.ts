import type { LearningListSlug, ProgressRecord } from "@/lib/types";

const STORAGE_KEY = "ngsl-mood-trainer-progress-v1";
const PROGRESS_EVENT = "ngsl-progress-change";

export const emptyProgressRecord: ProgressRecord = {
  totalCorrect: 0,
  totalAttempts: 0,
  streakDays: 1,
  learnedWords: {},
  recentActivity: [],
  difficultWords: [],
};

let cachedSerializedProgress: string | null = null;
let cachedProgressRecord: ProgressRecord = emptyProgressRecord;

function normalizeProgressRecord(value: unknown): ProgressRecord {
  return {
    ...emptyProgressRecord,
    ...(value as Partial<ProgressRecord>),
  } satisfies ProgressRecord;
}

export function loadProgress(): ProgressRecord {
  if (typeof window === "undefined") {
    return emptyProgressRecord;
  }

  const saved = window.localStorage.getItem(STORAGE_KEY);

  if (!saved) {
    cachedSerializedProgress = null;
    cachedProgressRecord = emptyProgressRecord;
    return emptyProgressRecord;
  }

  if (saved === cachedSerializedProgress) {
    return cachedProgressRecord;
  }

  try {
    cachedSerializedProgress = saved;
    cachedProgressRecord = normalizeProgressRecord(JSON.parse(saved));
    return cachedProgressRecord;
  } catch {
    cachedSerializedProgress = null;
    cachedProgressRecord = emptyProgressRecord;
    return emptyProgressRecord;
  }
}

export function saveProgress(progress: ProgressRecord) {
  if (typeof window === "undefined") {
    return;
  }

  const serialized = JSON.stringify(progress);
  cachedSerializedProgress = serialized;
  cachedProgressRecord = progress;
  window.localStorage.setItem(STORAGE_KEY, serialized);
  window.dispatchEvent(new Event(PROGRESS_EVENT));
}

export function recordAttempt({
  listSlug,
  lemma,
  correct,
}: {
  listSlug: LearningListSlug;
  lemma: string;
  correct: boolean;
}) {
  const progress = loadProgress();
  const learnedWords = { ...progress.learnedWords };
  const listWords = new Set(learnedWords[listSlug] ?? []);

  if (correct) {
    listWords.add(lemma.toLowerCase());
  }

  learnedWords[listSlug] = Array.from(listWords);

  const difficultWords = correct
    ? progress.difficultWords.filter((item) => item !== lemma.toLowerCase())
    : Array.from(new Set([...progress.difficultWords, lemma.toLowerCase()]));

  const next: ProgressRecord = {
    ...progress,
    totalAttempts: progress.totalAttempts + 1,
    totalCorrect: progress.totalCorrect + (correct ? 1 : 0),
    learnedWords,
    difficultWords,
    recentActivity: [
      {
        lemma: lemma.toLowerCase(),
        listSlug,
        correct,
        practicedAt: new Date().toISOString(),
      },
      ...progress.recentActivity,
    ].slice(0, 12),
  };

  saveProgress(next);
  return next;
}

export function getListProgressCount(
  progress: ProgressRecord,
  listSlug: LearningListSlug,
) {
  return progress.learnedWords[listSlug]?.length ?? 0;
}

export function subscribeToProgress(onStoreChange: () => void) {
  if (typeof window === "undefined") {
    return () => {};
  }

  const handleStorage = () => onStoreChange();
  const handleProgressEvent = () => onStoreChange();

  window.addEventListener("storage", handleStorage);
  window.addEventListener(PROGRESS_EVENT, handleProgressEvent);

  return () => {
    window.removeEventListener("storage", handleStorage);
    window.removeEventListener(PROGRESS_EVENT, handleProgressEvent);
  };
}
