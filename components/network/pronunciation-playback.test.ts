import { describe, expect, it, vi } from "vitest";

import { playAudioWithSpeechFallback } from "./pronunciation-playback";

describe("playAudioWithSpeechFallback", () => {
  it("speaks once when a media error fires as playback starts, even if play later rejects", async () => {
    let rejectPlay: (reason?: unknown) => void = () => {};
    const playPromise = new Promise<void>((_, reject) => {
      rejectPlay = reject;
    });
    const audio = new EventTarget() as EventTarget & { play: () => Promise<void> };
    audio.play = vi.fn(() => {
      audio.dispatchEvent(new Event("error"));
      return playPromise;
    });
    const speak = vi.fn();

    playAudioWithSpeechFallback(audio, speak);
    rejectPlay(new Error("media unavailable"));
    await Promise.resolve();

    expect(speak).toHaveBeenCalledTimes(1);
  });
});
