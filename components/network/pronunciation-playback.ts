type AudioPlaybackTarget = Pick<HTMLAudioElement, "addEventListener" | "removeEventListener" | "play">;

export function playAudioWithSpeechFallback(audio: AudioPlaybackTarget, speak: () => void) {
  let fellBack = false;
  const onError = () => fallback();
  const fallback = () => {
    if (fellBack) return;
    fellBack = true;
    audio.removeEventListener("error", onError);
    speak();
  };

  audio.addEventListener("error", onError, { once: true });
  try {
    void audio.play().catch(fallback);
  } catch {
    fallback();
  }
}
