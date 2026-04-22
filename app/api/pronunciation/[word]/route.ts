import { fetchFreePronunciationAudio } from "@/lib/audio/free-pronunciation";

export async function GET(
  _request: Request,
  context: { params: Promise<{ word: string }> },
) {
  const { word } = await context.params;
  return Response.json(await fetchFreePronunciationAudio(word));
}
