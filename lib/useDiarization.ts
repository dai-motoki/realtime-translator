"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { PcmRecorder } from "@/lib/audioCapture";

// Speaker diarization via Picovoice Falcon (on-device, in-browser WASM). It runs
// only when an AccessKey is configured AND the model file is reachable;
// otherwise the whole feature is a no-op and the app behaves exactly as before.
//
// Approach (matches the "auto-diarize, then reuse live" idea): we keep recording
// the mic, and every few seconds re-run Falcon over the WHOLE conversation so
// far. Falcon re-clusters everything and hands back consistent speaker tags
// across all utterances, including the newest — so labels appear and sharpen in
// near-real-time without anyone enrolling their voice first.
const ACCESS_KEY = process.env.NEXT_PUBLIC_PICOVOICE_ACCESS_KEY ?? "";
const MODEL_PATH =
  process.env.NEXT_PUBLIC_FALCON_MODEL_PATH ?? "/models/falcon_params.pv";

// Falcon needs a bit of audio before its clustering is meaningful.
const MIN_SAMPLES = 16000 * 3; // ~3s at 16 kHz

interface FalconSegment {
  startSec: number;
  endSec: number;
  speakerTag: number;
}
interface FalconLike {
  process: (
    pcm: Int16Array,
  ) => Promise<{ segments?: FalconSegment[] } | FalconSegment[]>;
  release?: () => Promise<void> | void;
}

/** A line we can place on the recording timeline. */
export interface TimedLine {
  id: string;
  startedAt?: number;
  at: number;
}

export function useDiarization() {
  const recRef = useRef<PcmRecorder | null>(null);
  const falconRef = useRef<FalconLike | null>(null);
  const loadingRef = useRef(false);
  const runningRef = useRef(false);
  const pendingRef = useRef(false);
  const failedRef = useRef(false);

  // segment id → speaker number (1-based). 0/undefined ⇒ unknown.
  const [speakers, setSpeakers] = useState<Record<string, number>>({});
  const [active, setActive] = useState(false);

  const configured = !!ACCESS_KEY;

  const ensureFalcon = useCallback(async (): Promise<FalconLike | null> => {
    if (falconRef.current) return falconRef.current;
    if (!configured || failedRef.current || loadingRef.current) return null;
    loadingRef.current = true;
    try {
      // FalconWorker runs the WASM engine off the main thread, so re-clustering
      // the whole recording never janks the live UI.
      const mod = (await import("@picovoice/falcon-web")) as {
        FalconWorker: { create: (k: string, m: unknown) => Promise<FalconLike> };
      };
      falconRef.current = await mod.FalconWorker.create(ACCESS_KEY, {
        publicPath: MODEL_PATH,
        forceWrite: true,
      });
    } catch (err) {
      // Missing model / bad key / unsupported browser — disable silently.
      failedRef.current = true;
      if (process.env.NODE_ENV !== "production") {
        console.warn("[diarization] Falcon unavailable:", err);
      }
    } finally {
      loadingRef.current = false;
    }
    return falconRef.current;
  }, [configured]);

  // Begin recording the conversation and warm up Falcon.
  const start = useCallback(
    async (stream: MediaStream) => {
      if (!configured) return;
      try {
        const rec = recRef.current ?? new PcmRecorder();
        recRef.current = rec;
        await rec.start(stream);
        setActive(true);
        void ensureFalcon();
      } catch {
        // capture not available — leave the feature off
      }
    },
    [configured, ensureFalcon],
  );

  const stop = useCallback(() => {
    recRef.current?.stop();
    setActive(false);
  }, []);

  // Forget the current speaker assignments (e.g. when history is cleared).
  const reset = useCallback(() => setSpeakers({}), []);

  // Re-diarize the whole recording and map Falcon's speaker tags back onto our
  // lines by timeline overlap. Coalesces concurrent calls.
  const run = useCallback(async (lines: TimedLine[]) => {
    const rec = recRef.current;
    if (!rec || !rec.recording || lines.length === 0) return;
    // Falcon is warmed up by start(); if it isn't ready yet, the next
    // (debounced) run will pick it up once enough audio has accumulated.
    const falcon = falconRef.current;
    if (!falcon) return;
    if (runningRef.current) {
      pendingRef.current = true;
      return;
    }
    runningRef.current = true;
    try {
      do {
        pendingRef.current = false;
        const pcm = rec.getPcm16k();
        if (pcm.length < MIN_SAMPLES) break;

        let segs: FalconSegment[];
        try {
          const res = await falcon.process(pcm);
          segs = Array.isArray(res) ? res : res.segments ?? [];
        } catch {
          break;
        }
        if (segs.length === 0) break;

        // Re-pack Falcon's raw tags into stable 1-based numbers in first-seen
        // order, so labels read "話者1, 話者2 …" in conversation order.
        const order = new Map<number, number>();
        const labelOf = (tag: number): number => {
          if (tag <= 0) return 0;
          let n = order.get(tag);
          if (!n) {
            n = order.size + 1;
            order.set(tag, n);
          }
          return n;
        };

        const next: Record<string, number> = {};
        for (const line of lines) {
          const a = rec.msToSample16k(line.startedAt ?? line.at);
          const b = rec.msToSample16k(line.at);
          let best = 0;
          let bestOverlap = 0;
          for (const fs of segs) {
            const fa = fs.startSec * 16000;
            const fb = fs.endSec * 16000;
            const overlap = Math.min(b, fb) - Math.max(a, fa);
            if (overlap > bestOverlap) {
              bestOverlap = overlap;
              best = labelOf(fs.speakerTag);
            }
          }
          // No overlap (timing skew): fall back to the segment nearest the
          // line's midpoint so it still gets a best-guess speaker.
          if (best === 0) {
            const mid = (a + b) / 2;
            let bestDist = Infinity;
            for (const fs of segs) {
              const fa = fs.startSec * 16000;
              const fb = fs.endSec * 16000;
              const dist =
                mid < fa ? fa - mid : mid > fb ? mid - fb : 0;
              if (dist < bestDist) {
                bestDist = dist;
                best = labelOf(fs.speakerTag);
              }
            }
          }
          if (best > 0) next[line.id] = best;
        }
        setSpeakers(next);
      } while (pendingRef.current);
    } finally {
      runningRef.current = false;
    }
  }, []);

  // Release the engine when the component using the hook unmounts.
  useEffect(() => {
    return () => {
      recRef.current?.stop();
      void falconRef.current?.release?.();
      falconRef.current = null;
    };
  }, []);

  return { configured, active, speakers, start, stop, reset, run };
}
