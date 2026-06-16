"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Smooth, time-based typewriter reveal for streaming text.
 *
 * Ported from ainewsblitz's streamed-translation typing loop. The realtime
 * translation API delivers text in bursts (a `delta` lands, then nothing for a
 * beat, then several at once), so rendering the raw buffer makes characters jump
 * out in clumps. Instead we reveal at a STEADY chars/sec rate and let a backlog
 * build up, so the output flows continuously instead of stop-and-go.
 *
 * Adaptive rate: each frame we aim to drain the current backlog
 * (generated-but-unshown chars) in ~DRAIN seconds, clamped to a comfortable
 * [MINR, MAXR] cps and eased so the speed itself never jumps. More buffered →
 * type faster (don't make the reader wait); little buffered (caught up to live
 * speech) → settle to a readable pace.
 */

// Reveal rate bounds (chars/sec) and the target backlog-drain time (sec).
// Tuned a touch snappier than the article reader since live subtitles should
// stay close behind the speaker rather than savour the text.
const MINR = 36; // floor: short translations still feel deliberate, not instant
const MAXR = 160; // ceiling: a big backlog blasts out but never faster than this
const DRAIN = 3; // empty the backlog in ~this many seconds
const EASE = 0.08; // rate smoothing — smaller = gentler speed changes

/**
 * Returns a progressively-revealed prefix of `full`. As `full` grows (new deltas
 * appended) the revealed prefix catches up at the adaptive rate above. When the
 * text is reset (e.g. a finalized line clears the live buffer) the cursor
 * resyncs to the longest common prefix so visible characters are never wrongly
 * rewritten.
 */
export function useTypewriter(full: string): string {
  const [shown, setShown] = useState(0);

  const fullRef = useRef(full);
  const shownRef = useRef(0);
  const rateRef = useRef(MINR);
  const carryRef = useRef(0);
  const lastRef = useRef(0);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    const prev = fullRef.current;
    fullRef.current = full;

    // If the new text isn't a clean append to what we've already revealed, the
    // buffer was replaced/reset (utterance finalized, or a wholesale rewrite).
    // Resync the cursor to the longest common prefix so we don't flash stale
    // characters, and never point past the end of the new text.
    if (!full.startsWith(prev.slice(0, shownRef.current))) {
      let i = 0;
      const max = Math.min(shownRef.current, full.length);
      while (i < max && full.charCodeAt(i) === prev.charCodeAt(i)) i++;
      shownRef.current = i;
      setShown(i);
    }
    if (shownRef.current > full.length) {
      shownRef.current = full.length;
      setShown(full.length);
    }

    const tick = (ts: number) => {
      if (!lastRef.current) lastRef.current = ts;
      const dt = (ts - lastRef.current) / 1000;
      lastRef.current = ts;

      const backlog = fullRef.current.length - shownRef.current;
      const target = Math.max(MINR, Math.min(MAXR, backlog / DRAIN));
      rateRef.current += (target - rateRef.current) * EASE;
      carryRef.current += rateRef.current * dt;

      const allow = Math.floor(carryRef.current);
      if (allow > 0) {
        carryRef.current -= allow;
        const room = fullRef.current.length - shownRef.current;
        const step = Math.min(allow, room);
        if (step > 0) {
          shownRef.current += step;
          setShown(shownRef.current);
        }
      }

      if (shownRef.current < fullRef.current.length) {
        rafRef.current = requestAnimationFrame(tick);
      } else {
        rafRef.current = null;
        lastRef.current = 0;
      }
    };

    if (shownRef.current < full.length && rafRef.current == null) {
      lastRef.current = 0;
      rafRef.current = requestAnimationFrame(tick);
    }
  }, [full]);

  // Stop the loop on unmount.
  useEffect(
    () => () => {
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
    },
    [],
  );

  return full.slice(0, Math.min(shown, full.length));
}

/**
 * Renders streaming text with the typewriter reveal. Keep the instance mounted
 * across the whole utterance (stable React key) so the cursor persists; a fresh
 * mount starts typing from the beginning.
 */
export function Typewriter({ text }: { text: string }) {
  return <>{useTypewriter(text)}</>;
}
