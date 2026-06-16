"use client";

import { useCallback, useRef, useState, useSyncExternalStore } from "react";

/**
 * One example sentence kept together with its translation. Keeping the original
 * and its translation in a single object guarantees they never drift apart when
 * items are merged.
 */
export interface Example {
  /** The example sentence in its own language. */
  text: string;
  /** That same sentence translated into the reader's My Page language. */
  local?: string;
}

export interface VocabItem {
  term: string;
  lang: string;
  reading: string;
  meaning: string;
  /** All example sentences seen for this item, each paired with its translation. */
  examples?: Example[];
  /** @deprecated Legacy single example — read for back-compat, no longer written. */
  example?: string;
  /** @deprecated Legacy single translation — read for back-compat, no longer written. */
  exampleLocal?: string;
  /** How many times this (or a near-identical) item has come up. */
  count?: number;
  /** Last time it was seen (for tie-breaking the sort). */
  at?: number;
  /** Total ms the learner has dwelt on this card while reviewing. */
  dwell?: number;
  /** Whether the learner has actually looked at this card at least once. */
  seen?: boolean;
}

export interface GrammarItem {
  title: string;
  lang: string;
  explanation: string;
  /** All example sentences seen for this item, each paired with its translation. */
  examples?: Example[];
  /** @deprecated Legacy single example — read for back-compat, no longer written. */
  example?: string;
  /** @deprecated Legacy single translation — read for back-compat, no longer written. */
  exampleLocal?: string;
  count?: number;
  at?: number;
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

/* ---- Near-duplicate merging (lexical similarity, no embeddings needed) ---- */

const norm = (s: string): string =>
  s
    .toLowerCase()
    .normalize("NFKC")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();

function bigrams(s: string): string[] {
  const t = s.replace(/\s+/g, "");
  if (t.length < 2) return t ? [t] : [];
  const out: string[] = [];
  for (let i = 0; i < t.length - 1; i++) out.push(t.slice(i, i + 2));
  return out;
}

// Character-bigram Dice coefficient — works for both spaced (Latin) and
// unspaced (CJK) text. 1 = identical, ~0 = unrelated.
function dice(a: string, b: string): number {
  if (a === b) return a ? 1 : 0;
  const A = bigrams(a);
  const B = bigrams(b);
  if (!A.length || !B.length) return 0;
  const counts = new Map<string, number>();
  for (const g of A) counts.set(g, (counts.get(g) ?? 0) + 1);
  let inter = 0;
  for (const g of B) {
    const c = counts.get(g);
    if (c) {
      inter += 1;
      counts.set(g, c - 1);
    }
  }
  return (2 * inter) / (A.length + B.length);
}

// Treat two strings as "the same item" when they're the same language and the
// text is identical or very close (high threshold avoids merging genuinely
// distinct vocabulary).
const SIMILAR_THRESHOLD = 0.82;
function similarText(a: string, b: string): boolean {
  const na = norm(a);
  const nb = norm(b);
  if (!na || !nb) return false;
  if (na === nb) return true;
  return dice(na, nb) >= SIMILAR_THRESHOLD;
}

const byCount = <T extends { count?: number; at?: number }>(a: T, b: T) =>
  (b.count ?? 1) - (a.count ?? 1) || (b.at ?? 0) - (a.at ?? 0);

/* ---- Example sentences (kept as original+translation pairs) ---- */

// How many example sentences to keep per item before dropping the oldest, so a
// frequently-seen word shows several past examples without growing unbounded.
const MAX_EXAMPLES = 6;

// Normalise an item's examples into the paired form, upgrading legacy entries
// that only had the scalar example/exampleLocal fields.
export function exampleList(item: {
  examples?: Example[];
  example?: string;
  exampleLocal?: string;
}): Example[] {
  const out: Example[] = [];
  if (Array.isArray(item.examples)) {
    for (const e of item.examples) {
      const text = (e?.text ?? "").trim();
      if (text) out.push({ text, local: (e?.local ?? "").trim() || undefined });
    }
  }
  const legacy = (item.example ?? "").trim();
  if (legacy && !out.some((e) => similarText(e.text, legacy))) {
    out.push({ text: legacy, local: (item.exampleLocal ?? "").trim() || undefined });
  }
  return out;
}

// Append new examples to the existing ones, skipping near-duplicates and
// keeping at most MAX_EXAMPLES (oldest dropped first).
function mergeExamples(cur: Example[], add: Example[]): Example[] {
  const out = cur.slice();
  for (const e of add) {
    const i = out.findIndex((x) => similarText(x.text, e.text));
    if (i >= 0) {
      // Backfill a translation onto an example we already had but couldn't pair.
      if (!out[i].local && e.local) out[i] = { ...out[i], local: e.local };
    } else {
      out.push(e);
    }
  }
  return out.length > MAX_EXAMPLES ? out.slice(out.length - MAX_EXAMPLES) : out;
}

function mergeVocab(list: VocabItem[], item: VocabItem): VocabItem[] {
  const idx = list.findIndex(
    (p) => p.lang === item.lang && similarText(p.term, item.term),
  );
  const now = Date.now();
  let next: VocabItem[];
  if (idx >= 0) {
    const cur = list[idx];
    next = list.slice();
    next[idx] = {
      ...cur,
      count: (cur.count ?? 1) + 1,
      at: now,
      // Backfill any fields the earlier copy was missing.
      reading: cur.reading || item.reading,
      meaning: cur.meaning || item.meaning,
      // Accumulate every example (paired with its own translation) over time.
      examples: mergeExamples(exampleList(cur), exampleList(item)),
      example: undefined,
      exampleLocal: undefined,
    };
  } else {
    next = [
      { ...item, examples: exampleList(item), example: undefined, exampleLocal: undefined, count: 1, at: now },
      ...list,
    ];
  }
  return next.sort(byCount);
}

function mergeGrammar(list: GrammarItem[], item: GrammarItem): GrammarItem[] {
  const idx = list.findIndex(
    (p) => p.lang === item.lang && similarText(p.title, item.title),
  );
  const now = Date.now();
  let next: GrammarItem[];
  if (idx >= 0) {
    const cur = list[idx];
    next = list.slice();
    next[idx] = {
      ...cur,
      count: (cur.count ?? 1) + 1,
      at: now,
      explanation: cur.explanation || item.explanation,
      examples: mergeExamples(exampleList(cur), exampleList(item)),
      example: undefined,
      exampleLocal: undefined,
    };
  } else {
    next = [
      { ...item, examples: exampleList(item), example: undefined, exampleLocal: undefined, count: 1, at: now },
      ...list,
    ];
  }
  return next.sort(byCount);
}

/**
 * Learning-optimised order: words you haven't looked at yet float to the top so
 * you meet them first; once seen, the ones you dwelt on longest (i.e. struggled
 * with) come next, with frequency/recency breaking ties.
 */
export function sortForLearning<
  T extends { count?: number; at?: number; dwell?: number; seen?: boolean },
>(list: T[]): T[] {
  return list.slice().sort((a, b) => {
    const sa = a.seen ? 1 : 0;
    const sb = b.seen ? 1 : 0;
    if (sa !== sb) return sa - sb; // unseen (0) first
    if (!a.seen) return byCount(a, b); // both unseen: frequency then recency
    return (b.dwell ?? 0) - (a.dwell ?? 0) || byCount(a, b); // both seen: longest dwell first
  });
}

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
  const [accumulating, setAccumulating] = useState(false);
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
  const accRef = useRef(false);

  const generate = useCallback(async (lines: StudyLine[], lang?: string) => {
    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;
    setGenerating(true);
    setError(null);
    try {
      const res = await fetch("/api/study", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ lines, lang }),
        signal: ac.signal,
      });
      const data = (await res.json().catch(() => null)) as
        | (Partial<StudySet> & { error?: string })
        | null;
      if (!res.ok) {
        setError(data?.error ?? "Failed to generate study material.");
        return;
      }
      setGenerated({
        vocab: Array.isArray(data?.vocab) ? data!.vocab : [],
        grammar: Array.isArray(data?.grammar) ? data!.grammar : [],
      });
    } catch (err) {
      if ((err as Error)?.name === "AbortError") return;
      setError("A network error occurred.");
    } finally {
      if (abortRef.current === ac) {
        setGenerating(false);
        abortRef.current = null;
      }
    }
  }, []);

  // Auto-accumulation: generate from the latest lines and silently file every
  // new vocab/grammar item into the saved lists (deduped). One run at a time.
  const accumulate = useCallback(async (lines: StudyLine[], lang?: string) => {
    if (accRef.current || lines.length === 0) return;
    accRef.current = true;
    setAccumulating(true);
    try {
      const res = await fetch("/api/study", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ lines, lang }),
      });
      if (!res.ok) return;
      const data = (await res.json().catch(() => null)) as
        | Partial<StudySet>
        | null;
      if (!data) return;

      let nextV = vocabStore.get();
      for (const v of Array.isArray(data.vocab) ? data.vocab : []) {
        if (v.term && v.meaning) nextV = mergeVocab(nextV, v);
      }
      if (nextV !== vocabStore.get()) vocabStore.set(nextV);

      let nextG = grammarStore.get();
      for (const g of Array.isArray(data.grammar) ? data.grammar : []) {
        if (g.title && g.explanation) nextG = mergeGrammar(nextG, g);
      }
      if (nextG !== grammarStore.get()) grammarStore.set(nextG);
    } catch {
      // network/parse errors are non-fatal for background accumulation
    } finally {
      accRef.current = false;
      setAccumulating(false);
    }
  }, []);

  const saveVocab = useCallback((item: VocabItem) => {
    vocabStore.set(mergeVocab(vocabStore.get(), item));
  }, []);

  const removeVocab = useCallback((key: string) => {
    vocabStore.set(vocabStore.get().filter((p) => vocabKey(p) !== key));
  }, []);

  // Record viewing time on a card; marks it seen so the learning sort can demote
  // it below words you haven't met yet. Does not re-sort the stored list, so
  // cards don't jump around while you're scrolling — the new order applies next
  // time the list is sorted (e.g. when the Vocabulary tab is reopened).
  const addVocabDwell = useCallback((key: string, ms: number) => {
    if (!(ms > 0)) return;
    const list = vocabStore.get();
    const idx = list.findIndex((p) => vocabKey(p) === key);
    if (idx < 0) return;
    const next = list.slice();
    next[idx] = { ...next[idx], dwell: (next[idx].dwell ?? 0) + ms, seen: true };
    vocabStore.set(next);
  }, []);

  const saveGrammar = useCallback((item: GrammarItem) => {
    grammarStore.set(mergeGrammar(grammarStore.get(), item));
  }, []);

  const removeGrammar = useCallback((key: string) => {
    grammarStore.set(grammarStore.get().filter((p) => grammarKey(p) !== key));
  }, []);

  // Whether a near-identical item is already saved (for the ＋/保存済み state).
  const hasVocab = useCallback(
    (item: VocabItem) =>
      savedVocab.some(
        (p) => p.lang === item.lang && similarText(p.term, item.term),
      ),
    [savedVocab],
  );
  const hasGrammar = useCallback(
    (item: GrammarItem) =>
      savedGrammar.some(
        (p) => p.lang === item.lang && similarText(p.title, item.title),
      ),
    [savedGrammar],
  );

  return {
    generated,
    generating,
    accumulating,
    error,
    generate,
    accumulate,
    savedVocab,
    savedGrammar,
    saveVocab,
    removeVocab,
    addVocabDwell,
    saveGrammar,
    removeGrammar,
    hasVocab,
    hasGrammar,
  };
}
