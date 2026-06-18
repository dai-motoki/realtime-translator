// Every English UI string in the app, in one place. English is the SOURCE
// language: components call t("<English text>") and the i18n provider swaps in a
// translation for the chosen "My Page" language (English shown first, then
// replaced once the translation arrives — cached in localStorage).
//
// This catalog is translated up-front when the language changes, so panels that
// mount later are already localized. t() also registers any string it sees, as a
// safety net for anything not listed here.

export const UI_STRINGS: string[] = [
  // ---- Translated FIRST (most visible) ----
  // The optimization indicator (shown in the target language while translating)
  // and the big centered empty state — so switching language changes the
  // on-screen text here first.
  "Optimizing the language…",
  "Auto-translate into every language",
  "Press “Start conversation” and just speak in any of the languages you picked. We detect the spoken language automatically and translate it into all the others, shown as a chat.",
  "Live translation",
  "Speak — we translate what we hear in real time.",
  "Pick an output language and press “Start translating”. For talks, videos and more, we translate the audio you hear as subtitles.",

  // ---- Header / status ----
  "Optimizing the latest conversation…",
  "Conversation",
  "Live",

  // ---- In-app browser banner ----
  "The microphone isn’t available in {app}’s in-app browser. Open this page in Safari or Chrome from the menu at the top right.",

  // ---- Footer controls ----
  "Audio output",
  "Pronunciation",
  "Show pronunciation (romaji, pinyin, IPA, etc.)",
  "Study",
  "Learn words and grammar from this conversation",
  "Log",
  "View saved conversation logs and minutes",
  "Face them",
  "Show to the other person (flip the screen)",
  "Clear history",
  "End",

  // ---- Start button ----
  "Connecting…",
  "Stop",
  "Start conversation",
  "Start translating",

  // ---- Language bars ----
  "Languages",
  "Close",
  "Show more",
  "Translate everything",
  "Select language",
  "Languages",
  "Search language…",
  "English (original)",

  // ---- Speak button ----
  "Read aloud",

  // ---- Message badge ----
  "Optimized with GPT-5.5",

  // ---- Mic / error help ----
  "Couldn’t access the microphone",
  "Something went wrong",
  "Try again",
  "Reload",

  // ---- Study panel ----
  "Adding…",
  "Adding from the conversation automatically",
  "Auto-collect",
  "Automatically add words and grammar from the conversation",
  "Learn from conversation",
  "Vocabulary",
  "Grammar notes",
  "words",
  "Review mode",
  "Review mode (hide meanings)",
  "Keep talking and words will collect here automatically (when Auto-collect is ON). You can also add them by hand from “Learn from conversation”.",
  "Keep talking and grammar points will collect here automatically (when Auto-collect is ON). You can also add them by hand from “Learn from conversation”.",
  "Generating…",
  "Generate again from this conversation",
  "Generate words & grammar from this conversation",
  "No conversation yet. Talk a little, then generate.",
  "Words & phrases",
  "Grammar points",
  "No words could be extracted.",
  "No grammar could be extracted.",
  "Saved",
  "Notes",
  "Tap to show the meaning",
  "Delete",
  "Appeared {n} times",
  "All",
  "New",
  "Not reviewed yet",
  "No words in this language yet.",
  "No grammar points in this language yet.",
  "Related words",
  "Related notes",
  "Search words (any language)…",
  "Search grammar (any language)…",
  "No matches.",
  "Clear",
  "My Page",
  "See your language levels",
  "Study time",
  "Repetition",
  "Examples",
  "Mastery",
  "Overall level",
  "min this week",
  "Last studied",
  "today",
  "{n}d ago",
  "Your level in each language, estimated from how much you've studied (time spent, words, grammar, examples and review).",
  "No study data yet. Collect some words and grammar first, then come back to see your levels.",

  // ---- Log / minutes panel ----
  "Minutes",
  "View minutes and conversation logs",
  "Conversation log",
  "Back to list",
  "Delete all saved minutes and conversation logs?",
  "Delete everything",
  "Clear all",
  "No minutes yet. When you end a conversation it’s saved automatically and its minutes are generated.",
  "Conversation record",
  "Live record",
  "lines",
  "Generating minutes…",
  "Failed to generate the minutes.",
  "Retry",
  "Topics",
  "Decisions",
  "To-dos / next actions",
  "Regenerate minutes",
  "See the full conversation log",
  "Conversation history",

  // ---- Speaker diarization ----
  "Speaker {n}",

  // ---- Hook / network errors (English source; translated like everything else) ----
  "Failed to generate study material.",
  "A network error occurred.",
  "There’s no conversation yet. Talk a little first, then generate.",
  "Microphone access was denied. Allow the microphone in your browser/OS settings and try again.",
  "No microphone was found. Check your device’s microphone.",
  "Couldn’t use the microphone. Check that no other app is using it.",
  "Couldn’t start the microphone.",
  "The microphone isn’t ready.",
  "Couldn’t start the session.",
  "Couldn’t connect for translation.",
  "This browser can’t capture audio. Open it in a supported browser such as Safari or Chrome over HTTPS (in-app browsers may not work).",

  // ---- Mic fix steps (per platform) ----
  "The microphone can’t be used in {app}’s in-app browser.",
  "From the menu at the top right choose “Open in Safari / Chrome” and reopen this page in a normal browser.",
  "On iPhone, open Settings → Chrome → Microphone and turn it on.",
  "Go back to Chrome, reload the page, and choose “Allow” on the prompt.",
  "Tap “ぁあ” at the left of the address bar → Website Settings → Microphone → Allow.",
  "Or open Settings → Safari → Camera & Microphone Access, turn it on, and reload.",
  "Tap 🔒 (or ⓘ) in the address bar → Permissions → Microphone → Allow.",
  "If that doesn’t fix it, open Settings → Apps → your browser → Permissions → Microphone, allow it, and reload.",
  "Tap 🔒 in the address bar and change “Microphone” to “Allow”.",
  "Reload the page and try again.",
];
