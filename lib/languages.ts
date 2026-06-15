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
