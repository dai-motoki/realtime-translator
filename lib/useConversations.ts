"use client";

import { useCallback, useSyncExternalStore } from "react";

/** One finalized line of a saved conversation (a trimmed-down Segment). */
export interface LoggedSegment {
  source: string;
  sourceLang: string | null;
  sourceReading?: string;
  /** Translations keyed by output language. */
  targets: Record<string, string>;
  readings?: Record<string, string>;
  /** Diarized speaker number (1-based); undefined when unknown. */
  speaker?: number;
  at: number;
}

/** Auto-generated meeting minutes for a saved conversation. */
export interface Minutes {
  title: string;
  summary: string;
  topics: string[];
  decisions: string[];
  actions: string[];
  /** Language the minutes were written in. */
  lang: string;
  at: number;
}

export type MinutesStatus = "idle" | "generating" | "ready" | "error";

export interface Conversation {
  id: string;
  mode: "talk" | "live";
  /** Conversation languages (talk) or the single output language (live). */
  langs: string[];
  segments: LoggedSegment[];
  startedAt: number;
  endedAt: number;
  /** Language the minutes should be written in (the reader's language). */
  minutesLang: string;
  minutes: Minutes | null;
  minutesStatus: MinutesStatus;
  minutesError?: string;
}

/** What the caller hands us to archive (everything else is derived). */
export interface ArchiveInput {
  mode: "talk" | "live";
  langs: string[];
  segments: LoggedSegment[];
  /** Language the minutes should be written in. */
  lang: string;
}

const KEY = "conversations:v1";

let convCounter = 0;

function load(): Conversation[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? (parsed as Conversation[]) : [];
  } catch {
    return [];
  }
}

// A tiny localStorage-backed store read via useSyncExternalStore: SSR-safe
// (server sees an empty list) and re-renders every subscriber on change.
// Mirrors the store in lib/useStudy.ts.
function makeStore() {
  let cache: Conversation[] | null = null;
  const listeners = new Set<() => void>();
  const get = (): Conversation[] => {
    if (cache === null) cache = load();
    return cache;
  };
  const set = (next: Conversation[]) => {
    cache = next;
    if (typeof window !== "undefined") {
      try {
        window.localStorage.setItem(KEY, JSON.stringify(next));
      } catch {
        // storage full / unavailable — persistence silently no-ops
      }
    }
    listeners.forEach((l) => l());
  };
  const subscribe = (cb: () => void) => {
    listeners.add(cb);
    return () => listeners.delete(cb);
  };
  return { get, set, subscribe };
}

const EMPTY: never[] = [];
const store = makeStore();

// Newest first, without mutating the stored array.
const sorted = (list: Conversation[]) =>
  [...list].sort((a, b) => b.endedAt - a.endedAt);

function patch(id: string, p: Partial<Conversation>) {
  store.set(store.get().map((c) => (c.id === id ? { ...c, ...p } : c)));
}

// Lines in the shape the /api/minutes route expects.
function toLines(c: Conversation) {
  return c.segments.map((s) => ({
    source: s.source,
    sourceLang: s.sourceLang,
    speaker: s.speaker,
    targets: Object.entries(s.targets).map(([lang, target]) => ({
      lang,
      target,
    })),
  }));
}

async function requestMinutes(id: string) {
  const conv = store.get().find((c) => c.id === id);
  if (!conv || conv.segments.length === 0) return;
  patch(id, { minutesStatus: "generating", minutesError: undefined });
  try {
    const res = await fetch("/api/minutes", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ lines: toLines(conv), lang: conv.minutesLang }),
    });
    const data = (await res.json().catch(() => null)) as
      | (Partial<Minutes> & { error?: string })
      | null;
    if (!res.ok || !data || data.error) {
      patch(id, {
        minutesStatus: "error",
        minutesError: data?.error ?? "Failed to generate the minutes.",
      });
      return;
    }
    patch(id, {
      minutesStatus: "ready",
      minutesError: undefined,
      minutes: {
        title: data.title ?? "",
        summary: data.summary ?? "",
        topics: Array.isArray(data.topics) ? data.topics : [],
        decisions: Array.isArray(data.decisions) ? data.decisions : [],
        actions: Array.isArray(data.actions) ? data.actions : [],
        lang: data.lang ?? conv.minutesLang,
        at: Date.now(),
      },
    });
  } catch {
    patch(id, {
      minutesStatus: "error",
      minutesError: "A network error occurred.",
    });
  }
}

/**
 * Conversation-log archive, persisted in localStorage. Saving a conversation
 * also kicks off automatic minutes (議事録) generation in the background.
 */
export function useConversations() {
  const conversations = useSyncExternalStore(
    store.subscribe,
    store.get,
    () => EMPTY,
  );

  // Save a finished conversation and start generating its minutes. Returns the
  // new id, or null when there's nothing to save / it's a duplicate of the most
  // recently saved one (so a stop-then-clear can't double-file it).
  const archive = useCallback((input: ArchiveInput): string | null => {
    const segs = input.segments;
    if (segs.length === 0) return null;

    const endedAt = segs[segs.length - 1]?.at ?? Date.now();
    const startedAt = segs[0]?.at ?? endedAt;

    const existing = store.get();
    const dup = existing.some(
      (c) =>
        c.segments.length === segs.length &&
        c.endedAt === endedAt &&
        c.startedAt === startedAt,
    );
    if (dup) return null;

    const id = `conv-${Date.now()}-${++convCounter}`;
    const conv: Conversation = {
      id,
      mode: input.mode,
      langs: input.langs,
      segments: segs,
      startedAt,
      endedAt,
      minutesLang: input.lang,
      minutes: null,
      minutesStatus: "generating",
    };
    store.set([conv, ...existing]);
    void requestMinutes(id);
    return id;
  }, []);

  const generateMinutes = useCallback((id: string) => {
    void requestMinutes(id);
  }, []);

  const remove = useCallback((id: string) => {
    store.set(store.get().filter((c) => c.id !== id));
  }, []);

  const clearAll = useCallback(() => {
    store.set([]);
  }, []);

  return {
    conversations: sorted(conversations),
    archive,
    generateMinutes,
    remove,
    clearAll,
  };
}
