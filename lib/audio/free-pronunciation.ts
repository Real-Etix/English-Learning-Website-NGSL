export interface FreePronunciationResult {
  audioUrl: string | null;
  sourceLabel: string;
}

export async function fetchFreePronunciationAudio(
  word: string,
): Promise<FreePronunciationResult> {
  try {
    const response = await fetch(
      `https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(word)}`,
      {
        next: {
          revalidate: 86400,
        },
      },
    );

    if (!response.ok) {
      return {
        audioUrl: null,
        sourceLabel: "Free dictionary audio not found",
      };
    }

    const payload = (await response.json()) as Array<{
      phonetics?: Array<{
        audio?: string;
      }>;
    }>;

    const audioUrl =
      payload
        .flatMap((entry) => entry.phonetics ?? [])
        .map((item) => item.audio?.trim())
        .find((item) => Boolean(item)) ?? null;

    return {
      audioUrl,
      sourceLabel: audioUrl
        ? "Free dictionary audio available"
        : "Free dictionary audio not found",
    };
  } catch {
    return {
      audioUrl: null,
      sourceLabel: "Free dictionary audio lookup failed",
    };
  }
}
