"use client";

import { useSyncExternalStore } from "react";

/**
 * Semantic embeddings for the study ranking. Vectors are fetched on demand
 * (batched, de-duplicated) and cached in memory for the session — they depend
 * only on the text, are cheap to recompute, and would bloat localStorage, so we
 * don't persist them. Stored unit-normalised so cosine similarity is a dot
 * product. A version counter lets React components re-rank when new vectors
 * arrive.
 */

const cache = new Map<string, Float32Array>();
const inflight = new Set<string>();
const listeners = new Set<() => void>();
let version = 0;

const notify = () => {
  version += 1;
  listeners.forEach((l) => l());
};

const norm = (t: string) => t.trim();

export function getEmbedding(text: string): Float32Array | undefined {
  return cache.get(norm(text));
}

function unit(v: number[]): Float32Array {
  let s = 0;
  for (const x of v) s += x * x;
  const inv = s > 0 ? 1 / Math.sqrt(s) : 0;
  const out = new Float32Array(v.length);
  for (let i = 0; i < v.length; i++) out[i] = v[i] * inv;
  return out;
}

async function fetchBatch(texts: string[]): Promise<void> {
  const res = await fetch("/api/embed", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ texts }),
  });
  if (!res.ok) throw new Error(`embed failed (${res.status})`);
  const data = (await res.json()) as { embeddings?: (number[] | null)[] };
  const embs = data.embeddings ?? [];
  texts.forEach((t, i) => {
    const e = embs[i];
    if (Array.isArray(e) && e.length) cache.set(t, unit(e));
  });
}

/**
 * Ensure embeddings exist for every text (skips ones already cached or being
 * fetched). Resolves once the network round-trips finish; notifies subscribers
 * a single time so the ranking recomputes once, not per batch.
 */
export async function ensureEmbeddings(texts: string[]): Promise<void> {
  const todo: string[] = [];
  const seen = new Set<string>();
  for (const raw of texts) {
    const t = norm(raw ?? "");
    if (!t || cache.has(t) || inflight.has(t) || seen.has(t)) continue;
    seen.add(t);
    todo.push(t);
  }
  if (todo.length === 0) return;

  for (const t of todo) inflight.add(t);
  const CHUNK = 256;
  const batches: string[][] = [];
  for (let i = 0; i < todo.length; i += CHUNK) {
    batches.push(todo.slice(i, i + CHUNK));
  }
  try {
    await Promise.all(batches.map((b) => fetchBatch(b).catch(() => {})));
  } finally {
    for (const t of todo) inflight.delete(t);
    notify();
  }
}

/** Re-renders the caller whenever new embeddings have been cached. */
export function useEmbeddingsVersion(): number {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => version,
    () => version,
  );
}
