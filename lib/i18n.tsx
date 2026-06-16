"use client";

// Client-side UI internationalization, modeled on ainewsblitz's approach:
// English is the source; when the user picks a "My Page" language we translate
// the whole UI into it (via /api/translate), show English first, then swap in
// the translation once it arrives. Results are cached in localStorage so the
// next visit is instant and offline-friendly.
//
// Strings are keyed by their English text — t("Start conversation") — so there's
// no separate key catalog to keep in sync. UI_STRINGS seeds the up-front batch
// (so panels that mount later are already translated); t() also registers any
// string it sees as a safety net.

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

// Every source string we might need to translate. Seeded from the catalog; t()
// adds anything new it encounters (e.g. a panel that mounts later). Growth is
// published as a version number so the provider can re-translate the newcomers.
const REGISTRY = new Set<string>(UI_STRINGS);
let registryVersion = 0;
const registryListeners = new Set<() => void>();
function registerString(s: string): void {
  if (REGISTRY.has(s)) return;
  REGISTRY.add(s);
  registryVersion += 1;
  // Notify outside the render phase (t() runs during render).
  queueMicrotask(() => registryListeners.forEach((l) => l()));
}
function subscribeRegistry(cb: () => void): () => void {
  registryListeners.add(cb);
  return () => registryListeners.delete(cb);
}
function getRegistryVersion(): number {
  return registryVersion;
}

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

// Resolved "My Page" language (stored choice or device locale), read SSR-safely:
// server + first client render see null → English, matching hydration, then the
// real language is applied on the client.
let cachedUiLang: string | null = null;
function uiLangSnapshot(): string | null {
  if (!cachedUiLang) cachedUiLang = resolveUiLang();
  return cachedUiLang;
}
const noopSubscribe = () => () => {};

type Ctx = { lang: string; t: (s: string) => string; setLang: (l: string) => void };
const I18nContext = createContext<Ctx>({ lang: "en", t: (s) => s, setLang: () => {} });

async function fetchTranslations(lang: string, items: string[]): Promise<Dict> {
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

  useEffect(() => {
    if (typeof document !== "undefined") document.documentElement.lang = lang;
  }, [lang]);

  useEffect(() => {
    // English is the source — t() returns it directly, no dict needed.
    if (lang === "en") return;
    let alive = true;
    (async () => {
      const cached = loadCache(lang);
      // Show any cached translations right away (English-first otherwise).
      if (alive && Object.keys(cached).length) setDict(cached);
      const missing = Array.from(REGISTRY).filter((s) => !(s in cached));
      if (missing.length === 0) return;
      const map = await fetchTranslations(lang, missing);
      if (!alive || Object.keys(map).length === 0) return;
      setDict((prev) => {
        const merged = { ...prev, ...cached, ...map };
        saveCache(lang, merged);
        return merged;
      });
    })();
    return () => {
      alive = false;
    };
    // regVersion: re-translate strings registered by panels that mounted later.
  }, [lang, regVersion]);

  const t = useCallback(
    (s: string) => {
      registerString(s); // safety net: translate strings not in the catalog too
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
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
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
