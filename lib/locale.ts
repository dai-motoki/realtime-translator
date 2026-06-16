// Pick the user's "base language" (the language they read/speak) from the
// device, and remember it across visits in localStorage.
//
// This mirrors ainewsblitz's locale-resolution algorithm (stored choice →
// device locale → region fallback → default), adapted for the browser: there
// is no Vercel `x-vercel-ip-country` header here, so we read the locale the OS
// reports through `navigator.languages` (language + region, e.g. "en-US",
// "zh-Hant-TW") instead of an IP-geolocated country.

import { LANGUAGES } from "@/lib/languages";

const SUPPORTED = new Set(LANGUAGES.map((l) => l.code));

/** localStorage key for the remembered base / output language. */
export const BASE_LANG_KEY = "rt:baseLang:v1";

/** Ultimate fallback when nothing about the device can be resolved. */
export const DEFAULT_BASE_LANG = "en";

// Region (ISO 3166-1 alpha-2) → supported language. Ported from ainewsblitz's
// COUNTRY_TO_LOCALE and collapsed onto the codes this app actually supports
// (e.g. zh-Hans / zh-Hant both become "zh"). Used as a fallback when the
// device's *language* subtag isn't one we support but its *region* hints at a
// language we do — e.g. a Catalan ("ca-ES") device falls back to Spanish.
const REGION_TO_LANG: Record<string, string> = {
  JP: "ja",
  CN: "zh", SG: "zh", TW: "zh", HK: "zh", MO: "zh",
  KR: "ko",
  ES: "es", MX: "es", AR: "es", CO: "es", CL: "es", PE: "es", VE: "es",
  FR: "fr",
  DE: "de", AT: "de", CH: "de",
  BR: "pt", PT: "pt",
  RU: "ru", BY: "ru",
  SA: "ar", AE: "ar", EG: "ar", QA: "ar", KW: "ar",
  IN: "hi",
  ID: "id",
  VN: "vi",
  IT: "it",
  TH: "th", TR: "tr", PL: "pl", NL: "nl", UA: "uk", IR: "fa", IL: "he",
  GB: "en", US: "en", AU: "en", CA: "en", NZ: "en", IE: "en",
};

// Legacy / alternate language subtags → the code this app uses.
const LANG_ALIASES: Record<string, string> = {
  iw: "he", // old code for Hebrew
  in: "id", // old code for Indonesian
  ji: "yi", // old code for Yiddish (unsupported → drops through)
  nb: "no", // Norwegian Bokmål
  nn: "no", // Norwegian Nynorsk
  fil: "tl", // Filipino → Tagalog
};

function splitTag(tag: string): { lang: string; region: string | null } {
  const parts = tag.replace(/_/g, "-").split("-");
  const lang = (parts[0] || "").toLowerCase();
  // The region subtag is the first 2-letter (ISO 3166-1) part after the
  // language, skipping any 4-letter script subtag (e.g. "Hant" in zh-Hant-TW).
  let region: string | null = null;
  for (let i = 1; i < parts.length; i++) {
    if (/^[A-Za-z]{2}$/.test(parts[i])) {
      region = parts[i].toUpperCase();
      break;
    }
  }
  return { lang, region };
}

/**
 * Map a single BCP-47 locale (e.g. "pt-BR", "zh-Hant-TW") to a language this
 * app supports, or null when neither its language nor its region resolve.
 */
export function localeToLang(tag: string | null | undefined): string | null {
  if (!tag) return null;
  const { lang, region } = splitTag(tag);
  const aliased = LANG_ALIASES[lang] ?? lang;
  if (SUPPORTED.has(aliased)) return aliased;
  if (region && REGION_TO_LANG[region] && SUPPORTED.has(REGION_TO_LANG[region])) {
    return REGION_TO_LANG[region];
  }
  return null;
}

/**
 * Resolve the device's preferred language, walking `navigator.languages` in
 * priority order. Returns {@link DEFAULT_BASE_LANG} when run without a browser
 * (SSR) or when nothing matches.
 */
export function detectDeviceLang(): string {
  if (typeof navigator === "undefined") return DEFAULT_BASE_LANG;
  const tags =
    navigator.languages && navigator.languages.length
      ? navigator.languages
      : navigator.language
        ? [navigator.language]
        : [];
  for (const tag of tags) {
    const code = localeToLang(tag);
    if (code) return code;
  }
  return DEFAULT_BASE_LANG;
}

/** Read the remembered base language, validated against supported codes. */
export function loadStoredBaseLang(): string | null {
  if (typeof window === "undefined") return null;
  try {
    const v = window.localStorage.getItem(BASE_LANG_KEY);
    return v && SUPPORTED.has(v) ? v : null;
  } catch {
    return null;
  }
}

/** Persist the chosen base / output language for next time. */
export function saveBaseLang(code: string): void {
  if (typeof window === "undefined" || !SUPPORTED.has(code)) return;
  try {
    window.localStorage.setItem(BASE_LANG_KEY, code);
  } catch {
    // Private mode / storage disabled — fall back to in-memory only.
  }
}

/**
 * Resolve the base language to use on load: a previously stored choice wins,
 * otherwise fall back to the device locale.
 */
export function resolveBaseLang(): string {
  return loadStoredBaseLang() ?? detectDeviceLang();
}

/**
 * Build the default set of conversation (multi-way) languages so the user's own
 * base language is always included and listed first. Mirrors the original
 * 3-language default while adapting its first slot to the device.
 *
 * NOTE: this only seeds the *initial* selection. It deliberately does not touch
 * any existing conversation languages or their translation results — the base /
 * "my page" language must never rewrite multi-language output.
 */
export function defaultConvLangs(base: string): string[] {
  const seed = [base, "en", "ja", "zh"];
  const out: string[] = [];
  for (const c of seed) {
    if (SUPPORTED.has(c) && !out.includes(c)) out.push(c);
  }
  return out.slice(0, 3);
}
