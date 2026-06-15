"use client";

import { type RefObject, useCallback, useRef, useState } from "react";
import { detectPairLanguage } from "@/lib/languages";

export type Status = "idle" | "connecting" | "live" | "error";

export interface LangPair {
  a: string;
  b: string;
}

export interface Segment {
  id: string;
  source: string;
  target: string;
  rawSource: string;
  rawTarget: string;
  outputLang: string;
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
// utterance ends. We segment ourselves: finalize after this much silence, or
// immediately when the spoken language switches.
const SEGMENT_GAP_MS = 1000;

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
  const [partialTarget, setPartialTarget] = useState("");
  const [speaking, setSpeaking] = useState(false);
  const [muted, setMutedState] = useState(false);
  const [audioOn, setAudioOnState] = useState(false);

  const sessionsRef = useRef<Session[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const outLangsRef = useRef<string[]>([]);
  const audioOnRef = useRef(false);

  // Per-utterance buffers.
  const srcBuf = useRef("");
  const tgtBufs = useRef<Record<string, string>>({}); // by output language
  const segLangRef = useRef<string | null>(null);
  const listenerLangRef = useRef<string | null>(null);
  const autoPairRef = useRef<LangPair | null>(null);
  const gapTimerRef = useRef<number | null>(null);

  const clearGap = useCallback(() => {
    if (gapTimerRef.current != null) {
      clearTimeout(gapTimerRef.current);
      gapTimerRef.current = null;
    }
  }, []);

  const finalize = useCallback(() => {
    clearGap();
    const source = srcBuf.current.trim();
    const lastSegLang = segLangRef.current;
    const pair = autoPairRef.current;

    let target = "";
    let outputLang = outLangsRef.current[0] ?? "en";
    let sourceLang: string | null = null;

    if (pair) {
      sourceLang =
        detectPairLanguage(source, pair.a, pair.b) ?? lastSegLang ?? pair.a;
      outputLang = sourceLang === pair.a ? pair.b : pair.a; // listener's language
      target = (tgtBufs.current[outputLang] ?? "").trim();
    } else {
      outputLang = outLangsRef.current[0] ?? "en";
      target = (tgtBufs.current[outputLang] ?? "").trim();
    }

    srcBuf.current = "";
    tgtBufs.current = {};
    segLangRef.current = null;
    listenerLangRef.current = null;
    setPartialSource("");
    setPartialTarget("");

    if (pair ? !source : !source && !target) return;

    setSegments((prev) => [
      ...prev,
      {
        id: `seg-${++segCounter}`,
        source,
        target,
        rawSource: source,
        rawTarget: target,
        outputLang,
        sourceLang,
        at: Date.now(),
      },
    ]);
  }, [clearGap]);

  const scheduleGap = useCallback(() => {
    clearGap();
    gapTimerRef.current = window.setTimeout(() => {
      gapTimerRef.current = null;
      finalize();
      setSpeaking(false);
    }, SEGMENT_GAP_MS);
  }, [clearGap, finalize]);

  const handleEvent = useCallback(
    (evt: RealtimeEvent, lang: string, isPrimary: boolean) => {
      const type = evt.type ?? "";

      if (type.endsWith("input_transcript.delta")) {
        // Both sessions transcribe the same audio — only the primary feeds the
        // source, to avoid double-counting.
        if (!isPrimary) return;
        const delta = evt.delta ?? "";
        const pair = autoPairRef.current;
        if (pair && delta) {
          const dLang = detectPairLanguage(delta, pair.a, pair.b);
          if (dLang) {
            // Other person started talking → close the previous line.
            if (
              segLangRef.current &&
              dLang !== segLangRef.current &&
              srcBuf.current.trim()
            ) {
              finalize();
            }
            segLangRef.current = dLang;
            listenerLangRef.current = dLang === pair.a ? pair.b : pair.a;
            setPartialTarget(tgtBufs.current[listenerLangRef.current] ?? "");
          }
        }
        srcBuf.current += delta;
        setPartialSource(srcBuf.current);
        setSpeaking(true);
        scheduleGap();
      } else if (type.endsWith("output_transcript.delta")) {
        const delta = evt.delta ?? "";
        tgtBufs.current[lang] = (tgtBufs.current[lang] ?? "") + delta;
        const pair = autoPairRef.current;
        // Show the translation for the current listener (auto) / the only
        // output (live).
        if (!pair || lang === listenerLangRef.current) {
          setPartialTarget(tgtBufs.current[lang]);
        }
        scheduleGap();
      } else if (type.endsWith("session.closed")) {
        if (isPrimary) {
          finalize();
          setSpeaking(false);
        }
      } else if (type === "error" || evt.error) {
        setError(evt.error?.message ?? "Realtime error");
      }
    },
    [finalize, scheduleGap],
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

  const cleanup = useCallback(() => {
    clearGap();
    for (const s of sessionsRef.current) {
      try {
        s.dc.close();
      } catch {}
      try {
        s.pc.close();
      } catch {}
    }
    sessionsRef.current = [];
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    if (audioRef.current) audioRef.current.srcObject = null;
    srcBuf.current = "";
    tgtBufs.current = {};
    segLangRef.current = null;
    listenerLangRef.current = null;
  }, [audioRef, clearGap]);

  const start = useCallback(
    async (outputLangs: string[]) => {
      if (sessionsRef.current.length) return;
      setError(null);
      outLangsRef.current = outputLangs;
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

      const single = outputLangs.length === 1;

      const buildSession = async (
        lang: string,
        isPrimary: boolean,
      ): Promise<Session> => {
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
        // in two-way mode there are two competing outputs, so audio stays off.
        if (single) {
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
            handleEvent(JSON.parse(e.data as string) as RealtimeEvent, lang, isPrimary);
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
      };

      try {
        const sessions = await Promise.all(
          outputLangs.map((lang, i) => buildSession(lang, i === 0)),
        );
        sessionsRef.current = sessions;
        setStatus("live");
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
        setStatus("error");
        cleanup();
      }
    },
    [audioRef, applyAudio, handleEvent, cleanup],
  );

  const setMuted = useCallback((m: boolean) => {
    const stream = streamRef.current;
    if (stream) stream.getAudioTracks().forEach((t) => (t.enabled = !m));
    setMutedState(m);
  }, []);

  const setAutoPair = useCallback((pair: LangPair | null) => {
    autoPairRef.current = pair;
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
    partialTarget,
    speaking,
    muted,
    audioOn,
    start,
    stop,
    setMuted,
    setAudioOn,
    setAutoPair,
    clear,
    patchSegment,
  };
}
