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
  /** Total ms the learner has dwelt on this card while reviewing. */
  dwell?: number;
  /** Whether the learner has actually looked at this card at least once. */
  seen?: boolean;
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

/* ------------------------------------------------------------------------- *
 * Learning-optimised ordering (engagement + similarity diffusion)
 *
 * Goal: cards you spend the most time on rise to the top, AND cards whose text
 * is "near in vector space" to those high-dwell cards rise with them — seen and
 * unseen alike, ranked together rather than always forcing unseen cards on top.
 *
 * Two well-studied ingredients:
 *
 *  1. Dwell time as an engagement signal. Dwell time on items is roughly
 *     log-normally distributed (Yi et al., "Beyond Clicks: Dwell Time for
 *     Personalization", RecSys 2014), so we use log(1 + seconds) as the raw
 *     interest seed y_i rather than raw milliseconds.
 *
 *  2. Manifold ranking / label propagation (Zhou et al., "Learning with Local
 *     and Global Consistency", NeurIPS 2003). The seed scores are diffused over
 *     a similarity graph W via the symmetric-normalised operator
 *     S = D^{-1/2} W D^{-1/2}, iterating  F ← αSF + (1−α)Y  to a stable point.
 *     This spreads engagement from a card to its neighbours, so vocabulary that
 *     looks/behaves like something you study a lot is surfaced too.
 *
 * The similarity W_ij is the cosine between character-bigram vectors of the two
 * cards' text (a real, if lexical, vector space — upgradeable to semantic
 * embeddings later), kept sparse with a minimum-similarity threshold.
 * ------------------------------------------------------------------------- */

// Fall back to a plain sort beyond this many items to keep the O(n²) graph
// build from janking the UI.
const RANK_MAX = 4000;
const RANK_SIM_MIN = 0.3; // ignore weak edges (keeps the graph sparse + meaningful)
const RANK_ALPHA = 0.6; // propagation strength (0 = engagement only, →1 = all diffusion)
const RANK_ITERS = 20; // iterations to converge the diffusion

const byDwell = <T extends { count?: number; at?: number; dwell?: number }>(
  a: T,
  b: T,
) => (b.dwell ?? 0) - (a.dwell ?? 0) || byCount(a, b);

// Bag-of-character-bigrams vector for one card's text.
function bigramVec(s: string): Map<string, number> {
  const m = new Map<string, number>();
  for (const g of bigrams(norm(s))) m.set(g, (m.get(g) ?? 0) + 1);
  return m;
}

function cosine(
  a: Map<string, number>,
  na: number,
  b: Map<string, number>,
  nb: number,
): number {
  if (!na || !nb) return 0;
  const [small, big] = a.size <= b.size ? [a, b] : [b, a];
  let dot = 0;
  for (const [g, c] of small) {
    const d = big.get(g);
    if (d) dot += c * d;
  }
  return dot / (na * nb);
}

export function rankForLearning<
  T extends { count?: number; at?: number; dwell?: number; seen?: boolean },
>(items: T[], textOf: (it: T) => string): T[] {
  const n = items.length;
  if (n <= 2 || n > RANK_MAX) return items.slice().sort(byDwell);

  // Vectors + L2 norms.
  const vecs = items.map((it) => bigramVec(textOf(it)));
  const norms = vecs.map((v) => {
    let s = 0;
    for (const c of v.values()) s += c * c;
    return Math.sqrt(s);
  });

  // Sparse similarity graph (upper triangle) + weighted degrees.
  const ei: number[] = [];
  const ej: number[] = [];
  const ew: number[] = [];
  const deg = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const w = cosine(vecs[i], norms[i], vecs[j], norms[j]);
      if (w >= RANK_SIM_MIN) {
        ei.push(i);
        ej.push(j);
        ew.push(w);
        deg[i] += w;
        deg[j] += w;
      }
    }
  }

  // Seed: log(1 + dwell seconds) — dwell time is ~log-normal.
  const y = items.map((it) => Math.log1p((it.dwell ?? 0) / 1000));

  // Symmetric-normalised diffusion: F ← αSF + (1−α)Y.
  let f = y.slice();
  const invSqrtDeg = Array.from(deg, (d) => (d > 0 ? 1 / Math.sqrt(d) : 0));
  for (let it = 0; it < RANK_ITERS; it++) {
    const nf = y.map((v) => (1 - RANK_ALPHA) * v);
    for (let e = 0; e < ew.length; e++) {
      const i = ei[e];
      const j = ej[e];
      const s = RANK_ALPHA * ew[e] * invSqrtDeg[i] * invSqrtDeg[j];
      nf[i] += s * f[j];
      nf[j] += s * f[i];
    }
    f = nf;
  }

  return items
    .map((it, i) => ({ it, score: f[i] }))
    .sort((a, b) => b.score - a.score || byDwell(a.it, b.it))
    .map((x) => x.it);
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

  // Record viewing time on a grammar card (see addVocabDwell).
  const addGrammarDwell = useCallback((key: string, ms: number) => {
    if (!(ms > 0)) return;
    const list = grammarStore.get();
    const idx = list.findIndex((p) => grammarKey(p) === key);
    if (idx < 0) return;
    const next = list.slice();
    next[idx] = { ...next[idx], dwell: (next[idx].dwell ?? 0) + ms, seen: true };
    grammarStore.set(next);
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
    addGrammarDwell,
    hasVocab,
    hasGrammar,
  };
}
