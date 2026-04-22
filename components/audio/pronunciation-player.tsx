"use client";

import { useEffect, useRef, useState } from "react";

import {
  lookupPronunciationAudio,
  speakWord,
} from "@/lib/audio/pronunciation-service";

export function PronunciationPlayer({
  word,
  initialAudioUrl = null,
  initialSourceLabel = "Checking free pronunciation audio...",
}: {
  word: string;
  initialAudioUrl?: string | null;
  initialSourceLabel?: string;
}) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [lastPlayedAt, setLastPlayedAt] = useState<string | null>(null);
  const [audioUrl, setAudioUrl] = useState<string | null>(initialAudioUrl);
  const [sourceLabel, setSourceLabel] = useState(initialSourceLabel);
  const [isPlaying, setIsPlaying] = useState(false);

  useEffect(() => {
    let active = true;

    void lookupPronunciationAudio(word).then((payload) => {
      if (!active) {
        return;
      }

      if (payload?.audioUrl) {
        setAudioUrl(payload.audioUrl);
        setSourceLabel(payload.sourceLabel ?? "Free dictionary audio ready");
        return;
      }

      setAudioUrl(null);
      setSourceLabel("Free audio not available. Browser voice fallback ready.");
    });

    return () => {
      active = false;
      if (audioRef.current) {
        audioRef.current.pause();
      }
    };
  }, [word]);

  const handlePlay = async () => {
    setIsPlaying(true);

    try {
      if (audioUrl) {
        if (!audioRef.current) {
          audioRef.current = new Audio(audioUrl);
        } else {
          audioRef.current.src = audioUrl;
        }

        audioRef.current.currentTime = 0;
        try {
          await audioRef.current.play();
          setSourceLabel("Playing free dictionary audio");
          setLastPlayedAt(new Date().toLocaleTimeString());
          return;
        } catch {
          setSourceLabel("Free audio could not play. Switching to browser voice.");
        }
      }

      const result = await speakWord(word);
      setSourceLabel(result.sourceLabel);
      setLastPlayedAt(result.ok ? new Date().toLocaleTimeString() : "Unavailable");
    } finally {
      setIsPlaying(false);
    }
  };

  return (
    <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-cyan-400/20 bg-cyan-400/10 px-4 py-3 text-sm text-cyan-50">
      <button
        type="button"
        onClick={handlePlay}
        disabled={isPlaying}
        className="rounded-full bg-cyan-300 px-4 py-2 font-semibold text-slate-950 transition hover:bg-cyan-200"
      >
        {isPlaying ? "Playing..." : "Play pronunciation"}
      </button>
      <div className="space-y-1">
        <div className="text-cyan-100/80">{sourceLabel}</div>
        <div className="text-cyan-100/70">Last play: {lastPlayedAt ?? "Not yet"}</div>
      </div>
      {audioUrl ? (
        <audio
          controls
          preload="none"
          src={audioUrl}
          className="h-10 max-w-full rounded-full"
        />
      ) : null}
    </div>
  );
}
