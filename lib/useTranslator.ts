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

// We deliberately DO NOT keep a long-lived realtime translation session.
// A persistent session degrades over time (transcripts silently stop coming
// in), so instead we listen to the mic *locally* and only open a brand-new
// realtime session while the user is actually speaking — then tear it down on
// every pause. Each utterance therefore gets a fresh session, fresh language
// detection, and a fresh API call. Nothing is ever reused.
//
// Local voice-activity-detection (VAD) thresholds, tuned for typical phone /
// laptop mics with the browser's own noise suppression already applied.
const VAD_OPEN_RMS = 0.02; // energy above this → start of an utterance
const VAD_VOICE_RMS = 0.012; // energy above this → speech is still ongoing
const SILENCE_MS = 700; // audio quiet for this long → utterance ended
const FLUSH_MS = 600; // also wait for the transcript tail to stop arriving
const VAD_INTERVAL_MS = 60; // how often we sample the mic energy

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
  const singleRef = useRef(false);
  const audioOnRef = useRef(false);

  // Local voice-activity detection (no API session involved).
  const audioCtxRef = useRef<AudioContext | null>(null);
  const sourceNodeRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const vadDataRef = useRef<Uint8Array<ArrayBuffer> | null>(null);
  const vadTimerRef = useRef<number | null>(null);
  const runningRef = useRef(false);
  const openingRef = useRef(false);
  const lastVoiceRef = useRef(0);
  const lastDeltaRef = useRef(0);

  // Per-utterance buffers.
  const srcBuf = useRef("");
  const tgtBufs = useRef<Record<string, string>>({}); // by output language
  const segLangRef = useRef<string | null>(null);
  const listenerLangRef = useRef<string | null>(null);
  const autoPairRef = useRef<LangPair | null>(null);

  const finalize = useCallback(() => {
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
  }, []);

  const handleEvent = useCallback(
    (evt: RealtimeEvent, lang: string, isPrimary: boolean) => {
      const type = evt.type ?? "";

      if (type.endsWith("input_transcript.delta")) {
        // Both sessions transcribe the same audio — only the primary feeds the
        // source, to avoid double-counting.
        if (!isPrimary) return;
        lastDeltaRef.current = Date.now();
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
      } else if (type.endsWith("output_transcript.delta")) {
        lastDeltaRef.current = Date.now();
        const delta = evt.delta ?? "";
        tgtBufs.current[lang] = (tgtBufs.current[lang] ?? "") + delta;
        const pair = autoPairRef.current;
        // Show the translation for the current listener (auto) / the only
        // output (live).
        if (!pair || lang === listenerLangRef.current) {
          setPartialTarget(tgtBufs.current[lang]);
        }
      } else if (type === "error" || evt.error) {
        setError(evt.error?.message ?? "Realtime error");
      }
    },
    [finalize],
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

  // Open a *fresh* realtime translation session (one per output language) for
  // the utterance that just started. Never reuses a previous session.
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
      // in two-way mode there are two competing outputs, so audio stays off.
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
          handleEvent(
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
    [audioRef, applyAudio, handleEvent],
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

  const openSessions = useCallback(async () => {
    if (openingRef.current || sessionsRef.current.length) return;
    openingRef.current = true;
    const now = Date.now();
    lastVoiceRef.current = now;
    lastDeltaRef.current = now;
    try {
      const langs = outLangsRef.current;
      const sessions = await Promise.all(
        langs.map((lang, i) => buildSession(lang, i === 0)),
      );
      // If listening was stopped (or a pause already closed us) while we were
      // negotiating, throw the just-built session away.
      if (!runningRef.current) {
        for (const s of sessions) {
          try {
            s.dc.close();
          } catch {}
          try {
            s.pc.close();
          } catch {}
        }
        return;
      }
      sessionsRef.current = sessions;
      lastDeltaRef.current = Date.now();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      openingRef.current = false;
    }
  }, [buildSession]);

  // Sampled ~16×/sec: opens a fresh session when speech starts, and finalizes
  // + cuts the session entirely once the speaker pauses.
  const vadTick = useCallback(() => {
    if (!runningRef.current) return;
    const analyser = analyserRef.current;
    const data = vadDataRef.current;
    if (!analyser || !data) return;

    analyser.getByteTimeDomainData(data);
    let sum = 0;
    for (let i = 0; i < data.length; i++) {
      const x = (data[i] - 128) / 128;
      sum += x * x;
    }
    const rms = Math.sqrt(sum / data.length);
    const now = Date.now();
    const active = sessionsRef.current.length > 0;

    if (rms > VAD_OPEN_RMS) {
      lastVoiceRef.current = now;
      if (!active && !openingRef.current) {
        setSpeaking(true);
        void openSessions();
      }
    } else if (rms > VAD_VOICE_RMS && active) {
      lastVoiceRef.current = now;
    }

    if (active) {
      const quietFor = now - lastVoiceRef.current;
      const sinceDelta = now - lastDeltaRef.current;
      // End the utterance only once the audio has gone quiet AND the model has
      // stopped streaming its transcript tail — then cut the session.
      if (quietFor > SILENCE_MS && sinceDelta > FLUSH_MS) {
        finalize();
        closeSessions();
        setSpeaking(false);
      }
    }
  }, [openSessions, finalize, closeSessions]);

  const cleanup = useCallback(() => {
    runningRef.current = false;
    if (vadTimerRef.current != null) {
      clearInterval(vadTimerRef.current);
      vadTimerRef.current = null;
    }
    closeSessions();
    openingRef.current = false;
    try {
      sourceNodeRef.current?.disconnect();
    } catch {}
    sourceNodeRef.current = null;
    analyserRef.current = null;
    vadDataRef.current = null;
    const ctx = audioCtxRef.current;
    audioCtxRef.current = null;
    if (ctx && ctx.state !== "closed") void ctx.close().catch(() => {});
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    srcBuf.current = "";
    tgtBufs.current = {};
    segLangRef.current = null;
    listenerLangRef.current = null;
  }, [closeSessions]);

  const start = useCallback(
    async (outputLangs: string[]) => {
      if (runningRef.current) return;
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

      // Wire up local voice-activity detection. This stays open for the whole
      // session, but it is entirely local — no API session is held open here.
      try {
        const Ctx =
          window.AudioContext ??
          (window as unknown as { webkitAudioContext: typeof AudioContext })
            .webkitAudioContext;
        const ctx = new Ctx();
        if (ctx.state === "suspended") await ctx.resume().catch(() => {});
        const sourceNode = ctx.createMediaStreamSource(stream);
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 1024;
        sourceNode.connect(analyser);
        audioCtxRef.current = ctx;
        sourceNodeRef.current = sourceNode;
        analyserRef.current = analyser;
        vadDataRef.current = new Uint8Array(new ArrayBuffer(analyser.fftSize));
      } catch (err) {
        setError(micErrorMessage(err));
        setStatus("error");
        cleanup();
        return;
      }

      runningRef.current = true;
      lastVoiceRef.current = Date.now();
      lastDeltaRef.current = Date.now();
      vadTimerRef.current = window.setInterval(vadTick, VAD_INTERVAL_MS);
      // "live" = armed and listening locally; sessions are opened on demand,
      // one fresh per utterance.
      setStatus("live");
    },
    [cleanup, vadTick],
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
