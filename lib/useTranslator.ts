"use client";

import { type RefObject, useCallback, useRef, useState } from "react";

export type Status = "idle" | "connecting" | "live" | "error";

export interface Segment {
  id: string;
  /** Original (auto-detected) speech */
  source: string;
  /** Translated text in the output language */
  target: string;
  /** Output language code this segment was translated into */
  outputLang: string;
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

export function useTranslator(audioRef: RefObject<HTMLAudioElement | null>) {
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState<string | null>(null);
  const [segments, setSegments] = useState<Segment[]>([]);
  const [partialSource, setPartialSource] = useState("");
  const [partialTarget, setPartialTarget] = useState("");
  const [speaking, setSpeaking] = useState(false);
  const [muted, setMutedState] = useState(false);
  const [outputLang, setOutputLang] = useState("en");

  const pcRef = useRef<RTCPeerConnection | null>(null);
  const dcRef = useRef<RTCDataChannel | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const srcBuf = useRef("");
  const tgtBuf = useRef("");
  const outLangRef = useRef("en");

  const finalize = useCallback(() => {
    const source = srcBuf.current.trim();
    const target = tgtBuf.current.trim();
    srcBuf.current = "";
    tgtBuf.current = "";
    setPartialSource("");
    setPartialTarget("");
    if (source || target) {
      setSegments((prev) => [
        ...prev,
        {
          id: `seg-${++segCounter}`,
          source,
          target,
          outputLang: outLangRef.current,
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

  const start = useCallback(
    async (initialOutputLang: string) => {
      if (pcRef.current) return;
      setError(null);
      setStatus("connecting");
      outLangRef.current = initialOutputLang;
      setOutputLang(initialOutputLang);
      setMutedState(false);

      try {
        // 1. Mint a single-use ephemeral secret from our own backend.
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

        // 2. Capture the microphone.
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: {
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true,
          },
        });
        streamRef.current = stream;

        // 3. Build the peer connection.
        const pc = new RTCPeerConnection();
        pcRef.current = pc;

        pc.ontrack = (e) => {
          if (audioRef.current) {
            audioRef.current.srcObject = e.streams[0];
            void audioRef.current.play().catch(() => {});
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
    [audioRef, handleEvent, sendOutputLanguage, cleanup],
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
    start,
    stop,
    setOutputLanguage,
    setMuted,
    clear,
  };
}
