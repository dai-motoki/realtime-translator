"use client";

import { useCallback, useRef, useState, useSyncExternalStore } from "react";

export interface VocabItem {
  term: string;
  lang: string;
  reading: string;
  meaning: string;
  example: string;
}

export interface GrammarItem {
  title: string;
  lang: string;
  explanation: string;
  example: string;
}

export interface StudySet {
  vocab: VocabItem[];
  grammar: GrammarItem[];
}

export interface StudyLine {
  source: string;
  sourceLang: string | null;
  targets: { lang: string; target: string }[];
}

const VOCAB_KEY = "study:vocab:v1";
const GRAMMAR_KEY = "study:grammar:v1";

// Stable identity for a saved item, used to dedupe and to remove.
export const vocabKey = (v: { lang: string; term: string }) =>
  `${v.lang}:${v.term}`;
export const grammarKey = (g: { lang: string; title: string }) =>
  `${g.lang}:${g.title}`;

function load<T>(key: string): T[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(key);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? (parsed as T[]) : [];
  } catch {
    return [];
  }
}

// A tiny localStorage-backed store read via useSyncExternalStore: SSR-safe
// (server sees an empty list) and re-renders every subscriber on change.
function makeStore<T>(key: string) {
  let cache: T[] | null = null;
  const listeners = new Set<() => void>();
  const get = (): T[] => {
    if (cache === null) cache = load<T>(key);
    return cache;
  };
  const set = (next: T[]) => {
    cache = next;
    if (typeof window !== "undefined") {
      try {
        window.localStorage.setItem(key, JSON.stringify(next));
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
const vocabStore = makeStore<VocabItem>(VOCAB_KEY);
const grammarStore = makeStore<GrammarItem>(GRAMMAR_KEY);

/**
 * Generates study material (vocabulary + grammar) from a conversation and keeps
 * the learner's saved items in localStorage so they persist on the device.
 */
export function useStudy() {
  const [generated, setGenerated] = useState<StudySet | null>(null);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const savedVocab = useSyncExternalStore(
    vocabStore.subscribe,
    vocabStore.get,
    () => EMPTY,
  );
  const savedGrammar = useSyncExternalStore(
    grammarStore.subscribe,
    grammarStore.get,
    () => EMPTY,
  );

  const abortRef = useRef<AbortController | null>(null);

  const generate = useCallback(async (lines: StudyLine[]) => {
    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;
    setGenerating(true);
    setError(null);
    try {
      const res = await fetch("/api/study", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ lines }),
        signal: ac.signal,
      });
      const data = (await res.json().catch(() => null)) as
        | (Partial<StudySet> & { error?: string })
        | null;
      if (!res.ok) {
        setError(data?.error ?? "学習教材の生成に失敗しました。");
        return;
      }
      setGenerated({
        vocab: Array.isArray(data?.vocab) ? data!.vocab : [],
        grammar: Array.isArray(data?.grammar) ? data!.grammar : [],
      });
    } catch (err) {
      if ((err as Error)?.name === "AbortError") return;
      setError("通信エラーが発生しました。");
    } finally {
      if (abortRef.current === ac) {
        setGenerating(false);
        abortRef.current = null;
      }
    }
  }, []);

  const saveVocab = useCallback((item: VocabItem) => {
    const cur = vocabStore.get();
    if (cur.some((p) => vocabKey(p) === vocabKey(item))) return;
    vocabStore.set([item, ...cur]);
  }, []);

  const removeVocab = useCallback((key: string) => {
    vocabStore.set(vocabStore.get().filter((p) => vocabKey(p) !== key));
  }, []);

  const saveGrammar = useCallback((item: GrammarItem) => {
    const cur = grammarStore.get();
    if (cur.some((p) => grammarKey(p) === grammarKey(item))) return;
    grammarStore.set([item, ...cur]);
  }, []);

  const removeGrammar = useCallback((key: string) => {
    grammarStore.set(grammarStore.get().filter((p) => grammarKey(p) !== key));
  }, []);

  return {
    generated,
    generating,
    error,
    generate,
    savedVocab,
    savedGrammar,
    saveVocab,
    removeVocab,
    saveGrammar,
    removeGrammar,
  };
}
