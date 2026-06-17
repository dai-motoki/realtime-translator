"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { getLanguage } from "@/lib/languages";

const SPEAK_URL = "/api/speak";

// A tiny, valid (empty) WAV. Playing this inside the user's click gesture
// "unlocks" the reused <audio> element on iOS/Safari, so the real play() we
// issue *after* the network round-trip isn't rejected by the autoplay policy.
const SILENT_WAV =
  "data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEARKwAAIhYAQACABAAZGF0YQAAAAA=";

/**
 * On-demand text-to-speech for finalized lines. Each playable line passes a
 * stable `key`; tapping the same key again stops playback (toggle). Only one
 * line plays at a time — starting a new one cancels the previous request and
 * audio.
 *
 * A single <audio> element is reused for every playback: mobile Safari only
 * lets an element play programmatically once it has been unlocked by a real
 * user gesture, and a freshly-created element (the previous approach) was
 * locked again every time — which made playback work only intermittently.
 */
export function useSpeech() {
  // The key currently being fetched, and the key currently audible.
  const [loadingKey, setLoadingKey] = useState<string | null>(null);
  const [playingKey, setPlayingKey] = useState<string | null>(null);

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const urlRef = useRef<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const unlockedRef = useRef(false);
  // Monotonic token so a slow request that resolves late can't hijack playback.
  const runRef = useRef(0);

  const getAudio = useCallback(() => {
    if (!audioRef.current) audioRef.current = new Audio();
    return audioRef.current;
  }, []);

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
    // Keep the element around (and unlocked) — just halt current playback.
    audioRef.current?.pause();
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

      const audio = getAudio();
      // Unlock the reused element inside the user gesture (iOS autoplay policy).
      if (!unlockedRef.current) {
        try {
          audio.src = SILENT_WAV;
          const p = audio.play();
          if (p) {
            p.then(() => {
              unlockedRef.current = true;
              audio.pause();
            }).catch(() => {});
          }
        } catch {
          // ignore — we still attempt the real play below
        }
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

        const a = getAudio();
        a.onended = () => {
          if (run === runRef.current) {
            setPlayingKey(null);
            cleanupUrl();
          }
        };
        a.src = url;
        setLoadingKey(null);
        setPlayingKey(key);
        await a.play();
        unlockedRef.current = true;
      } catch (err) {
        if ((err as Error)?.name === "AbortError") return;
        if (run === runRef.current) {
          setLoadingKey(null);
          setPlayingKey(null);
        }
      }
    },
    [playingKey, loadingKey, stop, cleanupUrl, getAudio],
  );

  // Tear down audio + object URL on unmount.
  useEffect(
    () => () => {
      stop();
      audioRef.current = null;
    },
    [stop],
  );

  return { speak, stop, loadingKey, playingKey };
}
