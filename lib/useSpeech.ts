"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { getLanguage } from "@/lib/languages";

const SPEAK_URL = "/api/speak";

/**
 * On-demand text-to-speech for finalized lines. Each playable line passes a
 * stable `key`; tapping the same key again stops playback (toggle). Only one
 * line plays at a time — starting a new one cancels the previous request and
 * audio.
 */
export function useSpeech() {
  // The key currently being fetched, and the key currently audible.
  const [loadingKey, setLoadingKey] = useState<string | null>(null);
  const [playingKey, setPlayingKey] = useState<string | null>(null);

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const urlRef = useRef<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  // Monotonic token so a slow request that resolves late can't hijack playback.
  const runRef = useRef(0);

  const cleanupUrl = useCallback(() => {
    if (urlRef.current) {
      URL.revokeObjectURL(urlRef.current);
      urlRef.current = null;
    }
  }, []);

  const stop = useCallback(() => {
    runRef.current += 1;
    abortRef.current?.abort();
    abortRef.current = null;
    audioRef.current?.pause();
    audioRef.current = null;
    cleanupUrl();
    setLoadingKey(null);
    setPlayingKey(null);
  }, [cleanupUrl]);

  const speak = useCallback(
    async (key: string, text: string, lang?: string) => {
      const trimmed = text.trim();
      if (!trimmed) return;
      // Tapping the active line again just stops it.
      if (key === playingKey || key === loadingKey) {
        stop();
        return;
      }

      stop();
      const run = (runRef.current += 1);
      const ac = new AbortController();
      abortRef.current = ac;
      setLoadingKey(key);

      try {
        const res = await fetch(SPEAK_URL, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            text: trimmed,
            language: lang ? getLanguage(lang).label : undefined,
          }),
          signal: ac.signal,
        });
        if (!res.ok) throw new Error(`speak failed (${res.status})`);
        const blob = await res.blob();
        if (run !== runRef.current) return; // superseded while downloading

        cleanupUrl();
        const url = URL.createObjectURL(blob);
        urlRef.current = url;

        // Fresh element per playback so we never mutate a ref-held object's
        // properties after the fact (only the ref's `.current` slot).
        const audio = new Audio(url);
        audio.onended = () => {
          if (run === runRef.current) {
            setPlayingKey(null);
            cleanupUrl();
          }
        };
        audioRef.current = audio;
        setLoadingKey(null);
        setPlayingKey(key);
        await audio.play();
      } catch (err) {
        if ((err as Error)?.name === "AbortError") return;
        if (run === runRef.current) {
          setLoadingKey(null);
          setPlayingKey(null);
        }
      }
    },
    [playingKey, loadingKey, stop, cleanupUrl],
  );

  // Tear down audio + object URL on unmount.
  useEffect(() => () => stop(), [stop]);

  return { speak, stop, loadingKey, playingKey };
}
