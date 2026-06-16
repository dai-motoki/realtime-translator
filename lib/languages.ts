// Output languages supported by the gpt-realtime-translate model.
// (Input speech is auto-detected from 70+ languages, so there is no source picker.)

export interface Language {
  code: string;
  /** Native name shown in the UI */
  name: string;
  /** Short English label */
  label: string;
  flag: string;
  /** Shown up-front (vs. behind the "もっと見る" expander). */
  common?: boolean;
}

export const LANGUAGES: Language[] = [
  // Common languages — shown by default.
  { code: "ja", name: "日本語", label: "Japanese", flag: "🇯🇵", common: true },
  { code: "en", name: "English", label: "English", flag: "🇺🇸", common: true },
  { code: "zh", name: "中文", label: "Chinese", flag: "🇨🇳", common: true },
  { code: "ko", name: "한국어", label: "Korean", flag: "🇰🇷", common: true },
  { code: "es", name: "Español", label: "Spanish", flag: "🇪🇸", common: true },
  { code: "fr", name: "Français", label: "French", flag: "🇫🇷", common: true },
  { code: "de", name: "Deutsch", label: "German", flag: "🇩🇪", common: true },
  { code: "it", name: "Italiano", label: "Italian", flag: "🇮🇹", common: true },
  { code: "pt", name: "Português", label: "Portuguese", flag: "🇧🇷", common: true },
  { code: "ru", name: "Русский", label: "Russian", flag: "🇷🇺", common: true },
  { code: "hi", name: "हिन्दी", label: "Hindi", flag: "🇮🇳", common: true },
  { code: "ar", name: "العربية", label: "Arabic", flag: "🇸🇦", common: true },
  { code: "nl", name: "Nederlands", label: "Dutch", flag: "🇳🇱", common: true },
  // More languages — revealed via the "もっと見る" expander.
  { code: "id", name: "Bahasa Indonesia", label: "Indonesian", flag: "🇮🇩" },
  { code: "th", name: "ไทย", label: "Thai", flag: "🇹🇭" },
  { code: "vi", name: "Tiếng Việt", label: "Vietnamese", flag: "🇻🇳" },
  { code: "tr", name: "Türkçe", label: "Turkish", flag: "🇹🇷" },
  { code: "pl", name: "Polski", label: "Polish", flag: "🇵🇱" },
  { code: "uk", name: "Українська", label: "Ukrainian", flag: "🇺🇦" },
  { code: "sv", name: "Svenska", label: "Swedish", flag: "🇸🇪" },
  { code: "da", name: "Dansk", label: "Danish", flag: "🇩🇰" },
  { code: "fi", name: "Suomi", label: "Finnish", flag: "🇫🇮" },
  { code: "no", name: "Norsk", label: "Norwegian", flag: "🇳🇴" },
  { code: "cs", name: "Čeština", label: "Czech", flag: "🇨🇿" },
  { code: "el", name: "Ελληνικά", label: "Greek", flag: "🇬🇷" },
  { code: "he", name: "עברית", label: "Hebrew", flag: "🇮🇱" },
  { code: "ro", name: "Română", label: "Romanian", flag: "🇷🇴" },
  { code: "hu", name: "Magyar", label: "Hungarian", flag: "🇭🇺" },
  { code: "ms", name: "Bahasa Melayu", label: "Malay", flag: "🇲🇾" },
  { code: "bn", name: "বাংলা", label: "Bengali", flag: "🇧🇩" },
  { code: "ta", name: "தமிழ்", label: "Tamil", flag: "🇮🇳" },
  { code: "ur", name: "اردو", label: "Urdu", flag: "🇵🇰" },
  { code: "fa", name: "فارسی", label: "Persian", flag: "🇮🇷" },
  { code: "tl", name: "Filipino", label: "Filipino", flag: "🇵🇭" },
  { code: "sk", name: "Slovenčina", label: "Slovak", flag: "🇸🇰" },
  { code: "bg", name: "Български", label: "Bulgarian", flag: "🇧🇬" },
  { code: "hr", name: "Hrvatski", label: "Croatian", flag: "🇭🇷" },
  { code: "sr", name: "Српски", label: "Serbian", flag: "🇷🇸" },
];

const BY_CODE = new Map(LANGUAGES.map((l) => [l.code, l]));

export function getLanguage(code: string): Language {
  return BY_CODE.get(code) ?? LANGUAGES[0];
}

// Latin-script output languages (used to disambiguate a Latin transcript).
const LATIN_LANGS = new Set([
  "en", "es", "fr", "de", "it", "pt", "nl", "id", "vi", "tr", "pl", "sv", "da",
  "fi", "no", "cs", "ro", "hu", "ms", "tl", "sk", "hr",
]);

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

/** Lowercase and strip punctuation/symbols so two transcripts can be compared. */
function normalizeForCompare(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Word-multiset Dice coefficient: 1 for identical text, ~0 for unrelated. */
function wordDice(a: string, b: string): number {
  const aw = a ? a.split(" ") : [];
  const bw = b ? b.split(" ") : [];
  if (!aw.length || !bw.length) return 0;
  const counts = new Map<string, number>();
  for (const w of bw) counts.set(w, (counts.get(w) ?? 0) + 1);
  let inter = 0;
  for (const w of aw) {
    const c = counts.get(w);
    if (c) {
      inter += 1;
      counts.set(w, c - 1);
    }
  }
  return (2 * inter) / (aw.length + bw.length);
}

/**
 * Decide the spoken language when the source text alone is ambiguous — e.g.
 * several conversation languages share the Latin script (English vs Malay), so
 * {@link detectLanguage} can't tell them apart.
 *
 * We run one translation session per language, so `outputs` also holds a
 * translation of this very utterance INTO each language. The session that
 * translated into the spoken language produced a near-identical copy of the
 * source, so the output whose text is closest to the source reveals which
 * language was actually spoken. Returns null when nothing matches well.
 */
export function detectLanguageByOutputs(
  source: string,
  langs: string[],
  outputs: Record<string, string>,
): string | null {
  const src = normalizeForCompare(source);
  if (!src) return null;
  let best: string | null = null;
  let bestScore = 0;
  for (const l of langs) {
    const out = outputs[l];
    if (!out) continue;
    const score = wordDice(src, normalizeForCompare(out));
    if (score > bestScore) {
      bestScore = score;
      best = l;
    }
  }
  // Require a strong match so an ordinary cross-language translation (which
  // shares few words with the source) is never mistaken for the spoken text.
  return bestScore >= 0.5 ? best : null;
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
