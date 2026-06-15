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
  /** Original (auto-detected) speech */
  source: string;
  /** Translated text in the output language */
  target: string;
  /** Output language code this segment was translated into */
  outputLang: string;
  /** Detected language the source was spoken in (auto mode), else null */
  sourceLang: string | null;
  at: number;
}

/** Shape of the JSON events that arrive over the `oai-events` data channel. */
interface RealtimeEvent {
  type?: string;
  delta?: string;
  error?: { message?: string };
}

const CALLS_URL = "https://api.openai.com/v1/realtime/translations/calls";

let segCounter = 0;

/** Turn a getUserMedia failure into a clear, mobile-friendly Japanese message. */
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
  const [outputLang, setOutputLang] = useState("en");
  // Translated audio playback is OFF by default — text is the primary output,
  // and keeping the speaker off avoids echo/feedback that disrupts mic VAD on phones.
  const [audioOn, setAudioOnState] = useState(false);

  const pcRef = useRef<RTCPeerConnection | null>(null);
  const dcRef = useRef<RTCDataChannel | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const srcBuf = useRef("");
  const tgtBuf = useRef("");
  const outLangRef = useRef("en");
  const audioOnRef = useRef(false);
  // When set, the translation direction is chosen automatically per utterance
  // from the detected source language (no manual side switching).
  const autoPairRef = useRef<LangPair | null>(null);

  const finalize = useCallback(() => {
    const source = srcBuf.current.trim();
    const target = tgtBuf.current.trim();
    srcBuf.current = "";
    tgtBuf.current = "";
    setPartialSource("");
    setPartialTarget("");
    if (source || target) {
      const pair = autoPairRef.current;
      let sourceLang: string | null = null;
      if (pair) {
        sourceLang =
          detectPairLanguage(source, pair.a, pair.b) ??
          (outLangRef.current === pair.a ? pair.b : pair.a);
      }
      setSegments((prev) => [
        ...prev,
        {
          id: `seg-${++segCounter}`,
          source,
          target,
          outputLang: outLangRef.current,
          sourceLang,
          at: Date.now(),
        },
      ]);
    }
  }, []);

  const handleEvent = useCallback(
    (evt: RealtimeEvent) => {
      const type = evt.type ?? "";
      if (type.endsWith("input_transcript.delta")) {
        srcBuf.current += evt.delta ?? "";
        setPartialSource(srcBuf.current);
        // Auto direction: the source transcript streams while the speaker is
        // still talking — before the translation starts — so we can detect the
        // spoken language and flip the output language in time.
        const pair = autoPairRef.current;
        if (pair) {
          const src = detectPairLanguage(srcBuf.current, pair.a, pair.b);
          if (src) {
            const other = src === pair.a ? pair.b : pair.a;
            if (other !== outLangRef.current) {
              outLangRef.current = other;
              const dc = dcRef.current;
              if (dc && dc.readyState === "open") {
                dc.send(
                  JSON.stringify({
                    type: "session.update",
                    session: { audio: { output: { language: other } } },
                  }),
                );
              }
            }
          }
        }
      } else if (type.endsWith("output_transcript.delta")) {
        tgtBuf.current += evt.delta ?? "";
        setPartialTarget(tgtBuf.current);
      } else if (
        type.endsWith("output_transcript.done") ||
        type.endsWith("output_transcript.completed") ||
        type.endsWith("input_transcript.done") ||
        type.endsWith("output_audio.done") ||
        type === "response.done"
      ) {
        finalize();
      } else if (type === "input_audio_buffer.speech_started") {
        // A new utterance is starting — flush anything still pending.
        finalize();
        setSpeaking(true);
      } else if (type === "input_audio_buffer.speech_stopped") {
        setSpeaking(false);
      } else if (type === "error" || evt.error) {
        setError(evt.error?.message ?? "Realtime error");
      }
    },
    [finalize],
  );

  const sendOutputLanguage = useCallback((lang: string) => {
    const dc = dcRef.current;
    if (dc && dc.readyState === "open") {
      dc.send(
        JSON.stringify({
          type: "session.update",
          session: { audio: { output: { language: lang } } },
        }),
      );
    }
  }, []);

  const cleanup = useCallback(() => {
    dcRef.current?.close();
    dcRef.current = null;
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    pcRef.current?.close();
    pcRef.current = null;
    if (audioRef.current) audioRef.current.srcObject = null;
    srcBuf.current = "";
    tgtBuf.current = "";
  }, [audioRef]);

  // Reflect the current audio-output preference onto the <audio> element.
  // Muted autoplay is always allowed; unmuting happens from a user gesture.
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

  const start = useCallback(
    async (initialOutputLang: string) => {
      if (pcRef.current) return;
      setError(null);
      outLangRef.current = initialOutputLang;
      setOutputLang(initialOutputLang);
      setMutedState(false);

      // 1. Capture the microphone FIRST, synchronously inside the tap gesture.
      //    iOS Safari revokes the user-activation after an unrelated await, so
      //    getUserMedia must run before the token fetch or it silently fails.
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
        // Permission/security failures won't be fixed by relaxing constraints.
        if (name === "NotAllowedError" || name === "SecurityError") {
          setError(micErrorMessage(err));
          setStatus("error");
          return;
        }
        // Some devices reject specific constraints — retry with the basics.
        try {
          stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        } catch (err2) {
          setError(micErrorMessage(err2));
          setStatus("error");
          return;
        }
      }
      streamRef.current = stream;

      try {
        // 2. Mint a single-use ephemeral secret from our own backend.
        const tokenRes = await fetch("/api/session", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ outputLanguage: initialOutputLang }),
        });
        const tokenData = (await tokenRes.json()) as {
          clientSecret?: string;
          error?: string;
        };
        if (!tokenRes.ok || !tokenData.clientSecret) {
          throw new Error(tokenData.error ?? "Failed to start a session.");
        }

        // 3. Build the peer connection.
        const pc = new RTCPeerConnection();
        pcRef.current = pc;

        pc.ontrack = (e) => {
          const el = audioRef.current;
          if (el) {
            el.srcObject = e.streams[0];
            applyAudio();
          }
        };
        pc.onconnectionstatechange = () => {
          const st = pc.connectionState;
          if (st === "failed") {
            setError("Connection lost.");
            setStatus("error");
          }
        };

        for (const track of stream.getAudioTracks()) {
          pc.addTrack(track, stream);
        }

        const dc = pc.createDataChannel("oai-events");
        dcRef.current = dc;
        dc.onmessage = (e) => {
          try {
            handleEvent(JSON.parse(e.data as string) as RealtimeEvent);
          } catch {
            // ignore non-JSON frames
          }
        };
        dc.onopen = () => {
          sendOutputLanguage(initialOutputLang);
          setStatus("live");
        };

        // 4. Offer / answer SDP exchange with the translation endpoint.
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
            `Translation handshake failed (${sdpRes.status}). ${txt.slice(0, 160)}`,
          );
        }
        await pc.setRemoteDescription({
          type: "answer",
          sdp: await sdpRes.text(),
        });
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
        setStatus("error");
        cleanup();
      }
    },
    [audioRef, handleEvent, sendOutputLanguage, cleanup, applyAudio],
  );

  const setOutputLanguage = useCallback(
    (lang: string) => {
      outLangRef.current = lang;
      setOutputLang(lang);
      sendOutputLanguage(lang);
    },
    [sendOutputLanguage],
  );

  const setMuted = useCallback((m: boolean) => {
    const stream = streamRef.current;
    if (stream) stream.getAudioTracks().forEach((t) => (t.enabled = !m));
    setMutedState(m);
  }, []);

  // Enable/disable automatic two-way direction for the given language pair.
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

  return {
    status,
    error,
    segments,
    partialSource,
    partialTarget,
    speaking,
    muted,
    outputLang,
    audioOn,
    start,
    stop,
    setOutputLanguage,
    setMuted,
    setAudioOn,
    setAutoPair,
    clear,
  };
}
