// Output languages supported by the gpt-realtime-translate model.
// (Input speech is auto-detected from 70+ languages, so there is no source picker.)

export interface Language {
  code: string;
  /** Native name shown in the UI */
  name: string;
  /** Short English label */
  label: string;
  flag: string;
}

export const LANGUAGES: Language[] = [
  { code: "ja", name: "日本語", label: "Japanese", flag: "🇯🇵" },
  { code: "en", name: "English", label: "English", flag: "🇺🇸" },
  { code: "zh", name: "中文", label: "Chinese", flag: "🇨🇳" },
  { code: "ko", name: "한국어", label: "Korean", flag: "🇰🇷" },
  { code: "es", name: "Español", label: "Spanish", flag: "🇪🇸" },
  { code: "fr", name: "Français", label: "French", flag: "🇫🇷" },
  { code: "de", name: "Deutsch", label: "German", flag: "🇩🇪" },
  { code: "it", name: "Italiano", label: "Italian", flag: "🇮🇹" },
  { code: "pt", name: "Português", label: "Portuguese", flag: "🇧🇷" },
  { code: "ru", name: "Русский", label: "Russian", flag: "🇷🇺" },
  { code: "hi", name: "हिन्दी", label: "Hindi", flag: "🇮🇳" },
  { code: "ar", name: "العربية", label: "Arabic", flag: "🇸🇦" },
  { code: "nl", name: "Nederlands", label: "Dutch", flag: "🇳🇱" },
];

const BY_CODE = new Map(LANGUAGES.map((l) => [l.code, l]));

export function getLanguage(code: string): Language {
  return BY_CODE.get(code) ?? LANGUAGES[0];
}

// Latin-script output languages (used to disambiguate a Latin transcript).
const LATIN_LANGS = new Set(["en", "es", "fr", "de", "it", "pt", "nl"]);

function scriptOf(text: string): string | null {
  if (/[぀-ゟ゠-ヿ]/.test(text)) return "ja"; // kana
  if (/[가-힯]/.test(text)) return "ko"; // hangul
  if (/[Ѐ-ӿ]/.test(text)) return "ru"; // cyrillic
  if (/[؀-ۿ]/.test(text)) return "ar"; // arabic
  if (/[ऀ-ॿ]/.test(text)) return "hi"; // devanagari
  if (/[一-鿿]/.test(text)) return "cjk"; // han (no kana ⇒ likely zh)
  if (/[a-zA-Z]/.test(text)) return "latin";
  return null;
}

/**
 * For a known set of conversation languages, decide which one `text` is written
 * in (used to auto-pick the translation direction). Returns null when the text
 * is in a script shared by several of the languages and can't be told apart
 * from text alone (e.g. Latin script when two Latin-script languages are in the
 * set).
 */
export function detectLanguage(text: string, langs: string[]): string | null {
  const s = scriptOf(text);
  if (!s) return null;
  const has = (x: string): string | null => (langs.includes(x) ? x : null);
  if (s === "latin") {
    const latin = langs.filter((l) => LATIN_LANGS.has(l));
    return latin.length === 1 ? latin[0] : null;
  }
  if (s === "cjk") {
    // Han characters with no kana ⇒ most likely Chinese; else Japanese.
    return has("zh") ?? has("ja");
  }
  // Other scripts map 1:1 to a language code.
  return has(s);
}

/**
 * Backwards-compatible two-language helper, expressed via {@link detectLanguage}.
 */
export function detectPairLanguage(
  text: string,
  a: string,
  b: string,
): string | null {
  return detectLanguage(text, [a, b]);
}
