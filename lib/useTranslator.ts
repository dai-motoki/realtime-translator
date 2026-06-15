"use client";

import { type RefObject, useCallback, useEffect, useRef, useState } from "react";
import { detectLanguage } from "@/lib/languages";

export type Status = "idle" | "connecting" | "live" | "error";

export interface Segment {
  id: string;
  source: string;
  rawSource: string;
  /** Translations keyed by output language (every language except the spoken one). */
  targets: Record<string, string>;
  rawTargets: Record<string, string>;
  sourceLang: string | null;
  refined?: boolean;
  at: number;
}

interface RealtimeEvent {
  type?: string;
  delta?: string;
  error?: { message?: string };
}

interface Session {
  pc: RTCPeerConnection;
  dc: RTCDataChannel;
  outputLang: string;
}

const CLIENT_SECRET_URL = "/api/session";
const CALLS_URL = "https://api.openai.com/v1/realtime/translations/calls";

// The translation API has "no turn lifecycle" — it never tells us where an
// utterance ends. We segment ourselves: finalize a displayed line after this
// much silence, or immediately when the spoken language switches.
const SEGMENT_GAP_MS = 1000;

// A long-lived realtime session degrades over time (transcripts silently stop
// arriving), so we never keep one around. We open a session up front (so the
// very first word is captured cleanly), then *cut it and mint a brand-new one*
// whenever the speaker has gone quiet for this long — i.e. on every pause.
// Each fresh session re-detects the language and re-hits the API from scratch.
const RECYCLE_SILENCE_MS = 2500;

// Safety net for long, pause-less monologues: even without a real pause, force
// a fresh session at the next segment boundary once the current one is this
// old, so a single session is never relied on for long.
const MAX_SESSION_MS = 30000;

let segCounter = 0;

function micErrorMessage(err: unknown): string {
  const name = err instanceof DOMException ? err.name : "";
  if (name === "NotAllowedError" || name === "SecurityError") {
    return "マイクの使用が許可されませんでした。ブラウザ／OSの設定でマイクを許可してから、もう一度お試しください。";
  }
  if (name === "NotFoundError" || name === "OverconstrainedError") {
    return "マイクが見つかりませんでした。デバイスのマイクを確認してください。";
  }
  if (name === "NotReadableError") {
    return "マイクを使用できませんでした。他のアプリがマイクを使用していないか確認してください。";
  }
  return err instanceof Error ? err.message : "マイクを起動できませんでした。";
}

export function useTranslator(audioRef: RefObject<HTMLAudioElement | null>) {
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState<string | null>(null);
  const [segments, setSegments] = useState<Segment[]>([]);
  const [partialSource, setPartialSource] = useState("");
  const [partialTargets, setPartialTargets] = useState<Record<string, string>>(
    {},
  );
  const [speaking, setSpeaking] = useState(false);
  const [muted, setMutedState] = useState(false);
  const [audioOn, setAudioOnState] = useState(false);

  const sessionsRef = useRef<Session[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const outLangsRef = useRef<string[]>([]);
  const singleRef = useRef(false);
  const audioOnRef = useRef(false);
  const runningRef = useRef(false);
  const openingRef = useRef(false);
  const sessionOpenedAtRef = useRef(0);

  // Per-utterance buffers.
  const srcBuf = useRef("");
  const tgtBufs = useRef<Record<string, string>>({}); // by output language
  const segLangRef = useRef<string | null>(null);
  // Conversation languages (auto multi-way translation). null ⇒ live mode
  // (translate everything into the single configured output language).
  const autoLangsRef = useRef<string[] | null>(null);
  const gapTimerRef = useRef<number | null>(null);
  const recycleTimerRef = useRef<number | null>(null);

  // Latest-value refs let the timer callbacks and the data-channel handler call
  // into these without forming a useCallback dependency cycle.
  const finalizeRef = useRef<() => void>(() => {});
  const recycleRef = useRef<() => void>(() => {});
  const handleEventRef = useRef<
    (evt: RealtimeEvent, lang: string, isPrimary: boolean) => void
  >(() => {});

  const clearTimers = useCallback(() => {
    if (gapTimerRef.current != null) {
      clearTimeout(gapTimerRef.current);
      gapTimerRef.current = null;
    }
    if (recycleTimerRef.current != null) {
      clearTimeout(recycleTimerRef.current);
      recycleTimerRef.current = null;
    }
  }, []);

  // The languages we currently show translations for: every conversation
  // language except the one being spoken (or the single live-mode output).
  const activeTargetLangs = useCallback((): string[] => {
    const langs = autoLangsRef.current;
    if (langs) {
      const src = segLangRef.current;
      return src ? langs.filter((l) => l !== src) : langs;
    }
    return outLangsRef.current;
  }, []);

  const refreshPartialTargets = useCallback(() => {
    const out: Record<string, string> = {};
    for (const l of activeTargetLangs()) {
      if (tgtBufs.current[l]) out[l] = tgtBufs.current[l];
    }
    setPartialTargets(out);
  }, [activeTargetLangs]);

  const finalize = useCallback(() => {
    if (gapTimerRef.current != null) {
      clearTimeout(gapTimerRef.current);
      gapTimerRef.current = null;
    }
    const source = srcBuf.current.trim();
    const langs = autoLangsRef.current;

    let sourceLang: string | null = null;
    let targetLangs: string[];
    if (langs) {
      sourceLang =
        detectLanguage(source, langs) ?? segLangRef.current ?? langs[0];
      targetLangs = langs.filter((l) => l !== sourceLang);
    } else {
      targetLangs = outLangsRef.current;
    }

    const targets: Record<string, string> = {};
    for (const l of targetLangs) {
      const v = (tgtBufs.current[l] ?? "").trim();
      if (v) targets[l] = v;
    }

    srcBuf.current = "";
    tgtBufs.current = {};
    segLangRef.current = null;
    setPartialSource("");
    setPartialTargets({});

    const hasTarget = Object.keys(targets).length > 0;
    if (langs ? !source : !source && !hasTarget) return;

    setSegments((prev) => [
      ...prev,
      {
        id: `seg-${++segCounter}`,
        source,
        rawSource: source,
        targets,
        rawTargets: { ...targets },
        sourceLang,
        at: Date.now(),
      },
    ]);
  }, []);

  const scheduleGap = useCallback(() => {
    if (gapTimerRef.current != null) clearTimeout(gapTimerRef.current);
    gapTimerRef.current = window.setTimeout(() => {
      gapTimerRef.current = null;
      finalizeRef.current();
      setSpeaking(false);
      // At a natural pause, refresh an aged session even if the longer
      // recycle timer hasn't fired yet.
      if (
        sessionsRef.current.length &&
        !openingRef.current &&
        Date.now() - sessionOpenedAtRef.current > MAX_SESSION_MS
      ) {
        recycleRef.current();
      }
    }, SEGMENT_GAP_MS);
  }, []);

  const scheduleRecycle = useCallback(() => {
    if (recycleTimerRef.current != null) clearTimeout(recycleTimerRef.current);
    recycleTimerRef.current = window.setTimeout(() => {
      recycleTimerRef.current = null;
      recycleRef.current();
    }, RECYCLE_SILENCE_MS);
  }, []);

  const handleEvent = useCallback(
    (evt: RealtimeEvent, lang: string, isPrimary: boolean) => {
      const type = evt.type ?? "";

      if (type.endsWith("input_transcript.delta")) {
        // Every session transcribes the same audio — only the primary feeds the
        // source, to avoid double-counting.
        if (!isPrimary) return;
        const delta = evt.delta ?? "";
        const langs = autoLangsRef.current;
        if (langs && delta) {
          const dLang = detectLanguage(delta, langs);
          if (dLang) {
            // Speaker switched language → close the previous line first.
            if (
              segLangRef.current &&
              dLang !== segLangRef.current &&
              srcBuf.current.trim()
            ) {
              finalizeRef.current();
            }
            segLangRef.current = dLang;
            refreshPartialTargets();
          }
        }
        srcBuf.current += delta;
        setPartialSource(srcBuf.current);
        setSpeaking(true);
        scheduleGap();
        scheduleRecycle();
      } else if (type.endsWith("output_transcript.delta")) {
        const delta = evt.delta ?? "";
        tgtBufs.current[lang] = (tgtBufs.current[lang] ?? "") + delta;
        if (activeTargetLangs().includes(lang)) refreshPartialTargets();
        scheduleGap();
        scheduleRecycle();
      } else if (type === "error" || evt.error) {
        setError(evt.error?.message ?? "Realtime error");
      }
    },
    [activeTargetLangs, refreshPartialTargets, scheduleGap, scheduleRecycle],
  );

  const applyAudio = useCallback(() => {
    const el = audioRef.current;
    if (!el) return;
    el.muted = !audioOnRef.current;
    if (audioOnRef.current) void el.play().catch(() => {});
  }, [audioRef]);

  const setAudioOn = useCallback(
    (on: boolean) => {
      audioOnRef.current = on;
      setAudioOnState(on);
      applyAudio();
    },
    [applyAudio],
  );

  // Mint a fresh realtime translation session for one output language. Always a
  // new credential, peer connection and language detection — never reused.
  const buildSession = useCallback(
    async (lang: string, isPrimary: boolean): Promise<Session> => {
      const stream = streamRef.current;
      if (!stream) throw new Error("マイクが初期化されていません。");

      const tokenRes = await fetch(CLIENT_SECRET_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ outputLanguage: lang }),
      });
      const tokenData = (await tokenRes.json()) as {
        clientSecret?: string;
        error?: string;
      };
      if (!tokenRes.ok || !tokenData.clientSecret) {
        throw new Error(tokenData.error ?? "セッションの開始に失敗しました。");
      }

      const pc = new RTCPeerConnection();
      // Only play translated audio when there's a single output (live mode);
      // in multi-way mode there are competing outputs, so audio stays off.
      if (singleRef.current) {
        pc.ontrack = (e) => {
          const el = audioRef.current;
          if (el) {
            el.srcObject = e.streams[0];
            applyAudio();
          }
        };
      }
      for (const track of stream.getAudioTracks()) pc.addTrack(track, stream);

      const dc = pc.createDataChannel("oai-events");
      dc.onmessage = (e) => {
        try {
          handleEventRef.current(
            JSON.parse(e.data as string) as RealtimeEvent,
            lang,
            isPrimary,
          );
        } catch {
          // ignore non-JSON frames
        }
      };

      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      const sdpRes = await fetch(CALLS_URL, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${tokenData.clientSecret}`,
          "Content-Type": "application/sdp",
        },
        body: offer.sdp,
      });
      if (!sdpRes.ok) {
        const txt = await sdpRes.text();
        throw new Error(
          `翻訳の接続に失敗しました (${sdpRes.status})。${txt.slice(0, 120)}`,
        );
      }
      await pc.setRemoteDescription({
        type: "answer",
        sdp: await sdpRes.text(),
      });
      return { pc, dc, outputLang: lang };
    },
    [audioRef, applyAudio],
  );

  const closeSessions = useCallback(() => {
    for (const s of sessionsRef.current) {
      try {
        s.dc.close();
      } catch {}
      try {
        s.pc.close();
      } catch {}
    }
    sessionsRef.current = [];
    if (audioRef.current) audioRef.current.srcObject = null;
  }, [audioRef]);

  const openSessions = useCallback(async (): Promise<boolean> => {
    if (openingRef.current || sessionsRef.current.length) return true;
    if (!runningRef.current || !streamRef.current) return false;
    openingRef.current = true;
    try {
      const langs = outLangsRef.current;
      const sessions = await Promise.all(
        langs.map((lang, i) => buildSession(lang, i === 0)),
      );
      // Listening may have stopped (or been re-cut) while we negotiated.
      if (!runningRef.current) {
        for (const s of sessions) {
          try {
            s.dc.close();
          } catch {}
          try {
            s.pc.close();
          } catch {}
        }
        return false;
      }
      sessionsRef.current = sessions;
      sessionOpenedAtRef.current = Date.now();
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      return false;
    } finally {
      openingRef.current = false;
    }
  }, [buildSession]);

  // Cut the current session(s) and immediately mint fresh ones. Called on each
  // sustained pause and when a session has aged out.
  const recycle = useCallback(() => {
    if (!runningRef.current || openingRef.current) return;
    finalizeRef.current();
    closeSessions();
    setSpeaking(false);
    void openSessions();
  }, [closeSessions, openSessions]);

  // Keep the latest-value refs in sync (used by timers / the data channel to
  // avoid useCallback dependency cycles).
  useEffect(() => {
    finalizeRef.current = finalize;
    handleEventRef.current = handleEvent;
    recycleRef.current = recycle;
  });

  const cleanup = useCallback(() => {
    runningRef.current = false;
    openingRef.current = false;
    clearTimers();
    closeSessions();
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    srcBuf.current = "";
    tgtBufs.current = {};
    segLangRef.current = null;
  }, [clearTimers, closeSessions]);

  const start = useCallback(
    async (outputLangs: string[]) => {
      if (runningRef.current || sessionsRef.current.length) return;
      setError(null);
      outLangsRef.current = outputLangs;
      singleRef.current = outputLangs.length === 1;
      setMutedState(false);

      if (!navigator.mediaDevices?.getUserMedia) {
        setError(
          "このブラウザでは音声入力を利用できません。HTTPSのSafari/Chromeなど対応ブラウザで開いてください（アプリ内ブラウザでは動かないことがあります）。",
        );
        setStatus("error");
        return;
      }
      setStatus("connecting");

      let stream: MediaStream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          audio: {
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true,
          },
        });
      } catch (err) {
        const name = err instanceof DOMException ? err.name : "";
        if (name === "NotAllowedError" || name === "SecurityError") {
          setError(micErrorMessage(err));
          setStatus("error");
          return;
        }
        try {
          stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        } catch (err2) {
          setError(micErrorMessage(err2));
          setStatus("error");
          return;
        }
      }
      streamRef.current = stream;
      runningRef.current = true;

      const ok = await openSessions();
      if (ok) {
        setStatus("live");
      } else if (runningRef.current) {
        setStatus("error");
        cleanup();
      }
    },
    [openSessions, cleanup],
  );

  const setMuted = useCallback((m: boolean) => {
    const stream = streamRef.current;
    if (stream) stream.getAudioTracks().forEach((t) => (t.enabled = !m));
    setMutedState(m);
  }, []);

  // Set the conversation languages (auto multi-way translation), or null for
  // single-output live mode.
  const setAutoLangs = useCallback((langs: string[] | null) => {
    autoLangsRef.current = langs && langs.length ? langs : null;
  }, []);

  const stop = useCallback(() => {
    finalize();
    cleanup();
    setStatus("idle");
    setSpeaking(false);
    setMutedState(false);
  }, [cleanup, finalize]);

  const clear = useCallback(() => setSegments([]), []);

  const patchSegment = useCallback((id: string, patch: Partial<Segment>) => {
    setSegments((prev) =>
      prev.map((s) => (s.id === id ? { ...s, ...patch } : s)),
    );
  }, []);

  return {
    status,
    error,
    segments,
    partialSource,
    partialTargets,
    speaking,
    muted,
    audioOn,
    start,
    stop,
    setMuted,
    setAudioOn,
    setAutoLangs,
    clear,
    patchSegment,
  };
}
