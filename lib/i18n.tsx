"use client";

// Client-side UI internationalization, modeled on ainewsblitz: English is the
// source; when the user picks a "My Page" language we translate the whole UI
// into it and STREAM the result in — each string reveals character by character
// as the model types it (via /api/translate/stream), exactly like ainewsblitz's
// dynamic streaming. A spinner shows until the stream starts. Results are cached
// in localStorage so the next visit is instant.
//
// Strings are keyed by their English text — t("Start conversation") — so there's
// no separate key catalog to keep in sync. UI_STRINGS seeds the up-front batch
// (so panels that mount later are already translated); t() also registers any
// string it sees and the provider re-translates the newcomers.

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { resolveUiLang, saveUiLang } from "@/lib/locale";
import { UI_STRINGS } from "@/lib/uiStrings";

type Dict = Record<string, string>;

const REGISTRY = new Set<string>(UI_STRINGS);
let registryVersion = 0;
const registryListeners = new Set<() => void>();
function registerString(s: string): void {
  if (REGISTRY.has(s)) return;
  REGISTRY.add(s);
  registryVersion += 1;
  queueMicrotask(() => registryListeners.forEach((l) => l()));
}
function subscribeRegistry(cb: () => void): () => void {
  registryListeners.add(cb);
  return () => registryListeners.delete(cb);
}
function getRegistryVersion(): number {
  return registryVersion;
}

// Label for the optimization indicator. Shown in the TARGET language (it's the
// first string translated), so we read it straight from the dict — never the
// English source — and show just the spinner until its translation lands.
const OPTIMIZING_LABEL = "Optimizing the language…";

const CACHE_PREFIX = "rt:i18n:"; // + lang

function loadCache(lang: string): Dict {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(CACHE_PREFIX + lang);
    const obj = raw ? JSON.parse(raw) : {};
    return obj && typeof obj === "object" ? (obj as Dict) : {};
  } catch {
    return {};
  }
}

function saveCache(lang: string, dict: Dict): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(CACHE_PREFIX + lang, JSON.stringify(dict));
  } catch {
    // storage full / unavailable — stay in-memory only
  }
}

// Resolved "My Page" language, read SSR-safely (server + first client render
// see null → English, matching hydration; the real language applies on client).
let cachedUiLang: string | null = null;
function uiLangSnapshot(): string | null {
  if (!cachedUiLang) cachedUiLang = resolveUiLang();
  return cachedUiLang;
}
const noopSubscribe = () => () => {};

type Ctx = { lang: string; t: (s: string) => string; setLang: (l: string) => void };
const I18nContext = createContext<Ctx>({ lang: "en", t: (s) => s, setLang: () => {} });

/** Non-streaming fallback (the batch /api/translate endpoint). */
async function fetchBatch(lang: string, items: string[]): Promise<Dict> {
  const CHUNK = 50;
  const out: Dict = {};
  for (let i = 0; i < items.length; i += CHUNK) {
    const slice = items.slice(i, i + CHUNK);
    try {
      const res = await fetch("/api/translate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ lang, items: slice }),
      });
      if (!res.ok) continue;
      const data = (await res.json().catch(() => null)) as
        | { translations?: Dict }
        | null;
      if (data?.translations) Object.assign(out, data.translations);
    } catch {
      // keep English for this chunk
    }
  }
  return out;
}

/**
 * Stream translations in. onItem(source, text, done) fires as the model types:
 * `text` is the (growing) partial until `done`, then the final string. Falls
 * back to the batch endpoint if streaming is unavailable.
 */
async function streamTranslations(
  lang: string,
  items: string[],
  onItem: (src: string, text: string, done: boolean) => void,
): Promise<void> {
  let got = false;
  try {
    const res = await fetch("/api/translate/stream", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ lang, items }),
    });
    if (res.status === 204) return; // nothing to translate
    if (!res.ok || !res.body) throw new Error("no stream");
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = "";
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      let sep: number;
      while ((sep = buf.indexOf("\n\n")) >= 0) {
        const chunk = buf.slice(0, sep);
        buf = buf.slice(sep + 2);
        const line = chunk.startsWith("data:") ? chunk.slice(5).trim() : chunk.trim();
        if (!line) continue;
        let ev: { i?: number; text?: string; done?: boolean };
        try {
          ev = JSON.parse(line);
        } catch {
          continue;
        }
        if (
          typeof ev.i === "number" &&
          typeof ev.text === "string" &&
          items[ev.i] != null
        ) {
          got = true;
          onItem(items[ev.i], ev.text, !!ev.done);
        }
      }
    }
    if (got) return;
    throw new Error("empty stream");
  } catch {
    // Fallback: non-streaming batch (still better than staying English).
    try {
      const map = await fetchBatch(lang, items);
      for (const [k, v] of Object.entries(map)) onItem(k, v, true);
    } catch {
      // keep English
    }
  }
}

export function I18nProvider({ children }: { children: ReactNode }) {
  const resolved = useSyncExternalStore(noopSubscribe, uiLangSnapshot, () => null);
  const regVersion = useSyncExternalStore(
    subscribeRegistry,
    getRegistryVersion,
    () => 0,
  );
  const [override, setOverride] = useState<string | null>(null);
  const lang = override ?? resolved ?? "en";
  const [dict, setDict] = useState<Dict>({});
  const [translating, setTranslating] = useState(false);

  useEffect(() => {
    if (typeof document !== "undefined") document.documentElement.lang = lang;
  }, [lang]);

  useEffect(() => {
    let alive = true;
    (async () => {
      if (lang === "en") {
        setTranslating(false);
        return;
      }
      const cached = loadCache(lang);
      if (Object.keys(cached).length) {
        setDict((prev) => ({ ...prev, ...cached }));
      }
      const missing = Array.from(REGISTRY).filter((s) => !(s in cached));
      if (missing.length === 0) {
        setTranslating(false);
        return;
      }
      // Show the optimization spinner for the whole pass; text streams in behind
      // it (the spinner's own label appears in the target language once ready).
      setTranslating(true);
      const collected: Dict = { ...cached };
      await streamTranslations(lang, missing, (src, text, done) => {
        if (!alive) return;
        setDict((prev) => ({ ...prev, [src]: text }));
        if (done) collected[src] = text; // cache finals only
      });
      if (!alive) return;
      setTranslating(false);
      saveCache(lang, collected);
    })();
    return () => {
      alive = false;
    };
  }, [lang, regVersion]);

  const t = useCallback(
    (s: string) => {
      registerString(s);
      if (lang === "en") return s;
      return dict[s] ?? s;
    },
    [lang, dict],
  );

  const setLang = useCallback((l: string) => {
    setOverride(l);
    saveUiLang(l);
  }, []);

  const value = useMemo<Ctx>(() => ({ lang, t, setLang }), [lang, t, setLang]);
  return (
    <I18nContext.Provider value={value}>
      {children}
      {translating && (
        <div className="i18n-translating" role="status" aria-live="polite">
          <span className="i18n-spinner" aria-hidden />
          {dict[OPTIMIZING_LABEL] ? <span>{dict[OPTIMIZING_LABEL]}</span> : null}
        </div>
      )}
    </I18nContext.Provider>
  );
}

/** Translate one English source string into the current My Page language. */
export function useT(): (s: string) => string {
  return useContext(I18nContext).t;
}

/** The current My Page (UI display) language code. */
export function useUiLang(): string {
  return useContext(I18nContext).lang;
}

/** Change the My Page (UI display) language. */
export function useSetUiLang(): (l: string) => void {
  return useContext(I18nContext).setLang;
}
