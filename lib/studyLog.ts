"use client";

import { useSyncExternalStore } from "react";

/**
 * A lightweight, time-stamped log of study activity (which language, how long),
 * so My Page can show recent growth and review recency on top of the all-time
 * dwell totals. Consecutive views of the same language within a short window are
 * merged to keep the log compact, and the log is capped to the most recent
 * entries.
 */
export interface ViewEvent {
  /** When (epoch ms). */
  t: number;
  lang: string;
  /** Milliseconds dwelt. */
  ms: number;
  /** "v" = vocabulary, "g" = grammar. */
  k: "v" | "g";
}

const KEY = "study:log:v1";
const MAX = 2000;
const MERGE_WINDOW = 5 * 60 * 1000; // fold views of one language within 5 min

let cache: ViewEvent[] | null = null;
const listeners = new Set<() => void>();

function load(): ViewEvent[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? (parsed as ViewEvent[]) : [];
  } catch {
    return [];
  }
}

function get(): ViewEvent[] {
  if (cache === null) cache = load();
  return cache;
}

function set(next: ViewEvent[]): void {
  cache = next;
  if (typeof window !== "undefined") {
    try {
      window.localStorage.setItem(KEY, JSON.stringify(next));
    } catch {
      // storage full / unavailable — persistence silently no-ops
    }
  }
  listeners.forEach((l) => l());
}

/** Append (or merge into the latest) a study event. */
export function logView(lang: string, ms: number, k: "v" | "g"): void {
  if (!lang || !(ms > 0)) return;
  const now = Date.now();
  const list = get();
  const last = list[list.length - 1];
  let next: ViewEvent[];
  if (last && last.lang === lang && last.k === k && now - last.t < MERGE_WINDOW) {
    next = list.slice();
    next[next.length - 1] = { ...last, ms: last.ms + ms, t: now };
  } else {
    next = [...list, { t: now, lang, ms, k }];
  }
  if (next.length > MAX) next = next.slice(next.length - MAX);
  set(next);
}

const EMPTY: ViewEvent[] = [];

/** Subscribe to the study log (re-renders on every new/merged event). */
export function useStudyLog(): ViewEvent[] {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    get,
    () => EMPTY,
  );
}
