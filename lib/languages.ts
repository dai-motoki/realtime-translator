// Languages available for translation.
//
// The full list is ported from ainewsblitz's 210-language table (the "211
// language" set). Of these, a curated subset is also supported by the
// gpt-realtime-translate model for *spoken* output — those are flagged
// `realtime: true`. The rest still translate as on-screen text (subtitles);
// the UI marks them so it's clear there's no realtime voice. Input speech is
// auto-detected, so there is no source picker.

export interface Language {
  code: string;
  /** Native name shown in the UI (falls back to the English label). */
  name: string;
  /** Short English label. */
  label: string;
  flag: string;
  /** Shown up-front (vs. behind the "もっと見る" expander). */
  common?: boolean;
  /** Supported by gpt-realtime-translate for live voice output. */
  realtime: boolean;
}

// BCP-47 code → English display name. Ported from ainewsblitz's LANGUAGE_NAMES.
const LANGUAGE_NAMES_EN: Record<string, string> = {
  ab: "Abkhaz", ace: "Acehnese", ach: "Acholi", aa: "Afar", af: "Afrikaans",
  sq: "Albanian", alz: "Alur", am: "Amharic", ar: "Arabic", hy: "Armenian",
  as: "Assamese", av: "Avar", awa: "Awadhi", ay: "Aymara", az: "Azerbaijani",
  ban: "Balinese", bal: "Baluchi", bm: "Bambara", bci: "Baoulé", ba: "Bashkir",
  eu: "Basque", btx: "Batak Karo", bts: "Batak Simalungun", bbc: "Batak Toba",
  be: "Belarusian", bem: "Bemba", bn: "Bengali", bew: "Betawi", bho: "Bhojpuri",
  bik: "Bikol", bs: "Bosnian", br: "Breton", bg: "Bulgarian", bua: "Buryat",
  yue: "Cantonese", ca: "Catalan", ceb: "Cebuano", ch: "Chamorro", ce: "Chechen",
  ny: "Chichewa", "zh-CN": "Chinese (Simplified)", "zh-TW": "Chinese (Traditional)",
  zh: "Chinese", chk: "Chuukese", cv: "Chuvash", co: "Corsican", crh: "Crimean Tatar",
  hr: "Croatian", cs: "Czech", da: "Danish", fa: "Persian (Farsi)", dv: "Dhivehi",
  din: "Dinka", doi: "Dogri", dov: "Dombe", nl: "Dutch", dyu: "Dyula", dz: "Dzongkha",
  en: "English", eo: "Esperanto", et: "Estonian", ee: "Ewe", fo: "Faroese",
  fj: "Fijian", fil: "Filipino", tl: "Filipino", fi: "Finnish", fon: "Fon",
  fr: "French", fy: "Frisian", fur: "Friulian", ff: "Fulani", gaa: "Ga",
  gl: "Galician", ka: "Georgian", de: "German", el: "Greek", gn: "Guarani",
  gu: "Gujarati", ht: "Haitian Creole", cnh: "Hakha Chin", ha: "Hausa", haw: "Hawaiian",
  iw: "Hebrew", he: "Hebrew", hil: "Hiligaynon", hi: "Hindi", hmn: "Hmong",
  hu: "Hungarian", hrx: "Hunsrik", is: "Icelandic", ig: "Igbo", ilo: "Ilocano",
  id: "Indonesian", ga: "Irish", it: "Italian", ja: "Japanese", jw: "Javanese",
  jv: "Javanese", kn: "Kannada", pam: "Kapampangan", kk: "Kazakh", km: "Khmer",
  cgg: "Kiga", rw: "Kinyarwanda", ktu: "Kituba", gom: "Konkani", ko: "Korean",
  kri: "Krio", ku: "Kurdish (Kurmanji)", ckb: "Kurdish (Sorani)", ky: "Kyrgyz",
  lo: "Lao", ltg: "Latgalian", la: "Latin", lv: "Latvian", lij: "Ligurian",
  li: "Limburgish", ln: "Lingala", lt: "Lithuanian", lmo: "Lombard", lg: "Luganda",
  luo: "Luo", lb: "Luxembourgish", mk: "Macedonian", mai: "Maithili", mak: "Makassar",
  mg: "Malagasy", ms: "Malay", ml: "Malayalam", mt: "Maltese", mi: "Maori",
  mr: "Marathi", mh: "Marshallese", mwr: "Marwadi", mfe: "Mauritian Creole",
  "mni-Mtei": "Meiteilon (Manipuri)", min: "Minang", lus: "Mizo", mn: "Mongolian",
  my: "Myanmar (Burmese)", nhe: "Nahuatl (Eastern Huasteca)", ndc: "Ndau",
  nr: "Ndebele (South)", new: "Nepalbhasa (Newari)", ne: "Nepali", no: "Norwegian",
  nus: "Nuer", oc: "Occitan", or: "Odia (Oriya)", om: "Oromo", pag: "Pangasinan",
  pap: "Papiamento", ps: "Pashto", pl: "Polish", pt: "Portuguese",
  "pt-PT": "Portuguese (Portugal)", pa: "Punjabi", "pa-Arab": "Punjabi (Shahmukhi)",
  qu: "Quechua", rom: "Romani", ro: "Romanian", rn: "Rundi", ru: "Russian",
  sm: "Samoan", sg: "Sango", sa: "Sanskrit", sat: "Santali", gd: "Scots Gaelic",
  nso: "Sepedi", sr: "Serbian", st: "Sesotho", crs: "Seychellois Creole", shn: "Shan",
  sn: "Shona", scn: "Sicilian", szl: "Silesian", sd: "Sindhi", si: "Sinhala",
  sk: "Slovak", sl: "Slovenian", so: "Somali", es: "Spanish", su: "Sundanese",
  sw: "Swahili", ss: "Swati", sv: "Swedish", tg: "Tajik", ta: "Tamil", tt: "Tatar",
  te: "Telugu", tet: "Tetum", th: "Thai", ti: "Tigrinya", ts: "Tsonga", tn: "Tswana",
  tr: "Turkish", tk: "Turkmen", ak: "Twi (Akan)", uk: "Ukrainian", ur: "Urdu",
  ug: "Uyghur", uz: "Uzbek", vi: "Vietnamese", cy: "Welsh", xh: "Xhosa", yi: "Yiddish",
  yo: "Yoruba", yua: "Yucatec Maya", zu: "Zulu",
};

// Codes the gpt-realtime-translate model supports as spoken output. Everything
// else is text-only (subtitles), surfaced with a marker in the UI.
const REALTIME_VOICE = new Set([
  "ja", "en", "zh", "ko", "es", "fr", "de", "it", "pt", "ru", "hi", "ar", "nl",
  "id", "th", "vi", "tr", "pl", "uk", "sv", "da", "fi", "no", "cs", "el", "he",
  "ro", "hu", "ms", "bn", "ta", "ur", "fa", "tl", "sk", "bg", "hr", "sr",
]);

// Hand-curated native names + flags (nicer than an autonym lookup, and stable
// across SSR/client so there's no hydration mismatch). `common` languages show
// up-front in the picker.
const CURATED: Record<string, { name?: string; flag?: string; common?: boolean }> = {
  ja: { name: "日本語", flag: "🇯🇵", common: true },
  en: { name: "English", flag: "🇺🇸", common: true },
  zh: { name: "中文", flag: "🇨🇳", common: true },
  ko: { name: "한국어", flag: "🇰🇷", common: true },
  es: { name: "Español", flag: "🇪🇸", common: true },
  fr: { name: "Français", flag: "🇫🇷", common: true },
  de: { name: "Deutsch", flag: "🇩🇪", common: true },
  it: { name: "Italiano", flag: "🇮🇹", common: true },
  pt: { name: "Português", flag: "🇧🇷", common: true },
  ru: { name: "Русский", flag: "🇷🇺", common: true },
  hi: { name: "हिन्दी", flag: "🇮🇳", common: true },
  ar: { name: "العربية", flag: "🇸🇦", common: true },
  nl: { name: "Nederlands", flag: "🇳🇱", common: true },
  id: { name: "Bahasa Indonesia", flag: "🇮🇩" },
  th: { name: "ไทย", flag: "🇹🇭" },
  vi: { name: "Tiếng Việt", flag: "🇻🇳" },
  tr: { name: "Türkçe", flag: "🇹🇷" },
  pl: { name: "Polski", flag: "🇵🇱" },
  uk: { name: "Українська", flag: "🇺🇦" },
  sv: { name: "Svenska", flag: "🇸🇪" },
  da: { name: "Dansk", flag: "🇩🇰" },
  fi: { name: "Suomi", flag: "🇫🇮" },
  no: { name: "Norsk", flag: "🇳🇴" },
  cs: { name: "Čeština", flag: "🇨🇿" },
  el: { name: "Ελληνικά", flag: "🇬🇷" },
  he: { name: "עברית", flag: "🇮🇱" },
  ro: { name: "Română", flag: "🇷🇴" },
  hu: { name: "Magyar", flag: "🇭🇺" },
  ms: { name: "Bahasa Melayu", flag: "🇲🇾" },
  bn: { name: "বাংলা", flag: "🇧🇩" },
  ta: { name: "தமிழ்", flag: "🇮🇳" },
  ur: { name: "اردو", flag: "🇵🇰" },
  fa: { name: "فارسی", flag: "🇮🇷" },
  tl: { name: "Filipino", flag: "🇵🇭" },
  sk: { name: "Slovenčina", flag: "🇸🇰" },
  bg: { name: "Български", flag: "🇧🇬" },
  hr: { name: "Hrvatski", flag: "🇭🇷" },
  sr: { name: "Српски", flag: "🇷🇸" },
  // Variants kept from the long tail — flag only, English label as name.
  "zh-CN": { flag: "🇨🇳" },
  "zh-TW": { flag: "🇹🇼" },
  "pt-PT": { flag: "🇵🇹" },
};

// Common languages first (in this order), then alphabetical by English label.
const PRIORITY = [
  "ja", "en", "zh", "ko", "es", "fr", "de", "it", "pt", "ru", "hi", "ar", "nl",
];

export const LANGUAGES: Language[] = Object.entries(LANGUAGE_NAMES_EN)
  .map(([code, label]) => {
    const c = CURATED[code];
    return {
      code,
      label,
      name: c?.name ?? label,
      flag: c?.flag ?? "🌐",
      common: c?.common ?? false,
      realtime: REALTIME_VOICE.has(code),
    };
  })
  .sort((a, b) => {
    const pa = PRIORITY.indexOf(a.code);
    const pb = PRIORITY.indexOf(b.code);
    if (pa !== -1 || pb !== -1) {
      return (pa === -1 ? 999 : pa) - (pb === -1 ? 999 : pb);
    }
    return a.label.localeCompare(b.label);
  });

const BY_CODE = new Map(LANGUAGES.map((l) => [l.code, l]));

export function getLanguage(code: string): Language {
  return BY_CODE.get(code) ?? LANGUAGES[0];
}

/** Whether a language has live (spoken) realtime translation, vs. text only. */
export function isRealtimeVoice(code: string): boolean {
  return REALTIME_VOICE.has(code);
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
