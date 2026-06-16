import type { NextRequest } from "next/server";
import { getLanguage } from "@/lib/languages";

export const dynamic = "force-dynamic";

const CHAT_URL = "https://api.openai.com/v1/chat/completions";
// A normal text model is plenty for short UI strings; override via env if wanted.
const MODEL =
  process.env.TRANSLATE_MODEL || process.env.REFINE_MODEL || "gpt-5.5";

interface TranslateBody {
  /** Target language (BCP-47 / app code, e.g. "ja", "zh", "fr"). */
  lang?: string;
  /** English source strings to translate. */
  items?: unknown;
}

const SYSTEM = `You localize short UI strings for a mobile app. You are given a JSON array of English strings. Translate EACH string into the target language, naturally and concisely, the way a native app would phrase it.

Rules:
- Keep placeholders EXACTLY as-is: tokens in curly braces like {app}, {n}, and any HTML — do not translate or reorder their contents.
- Keep emoji, arrows (→), punctuation, and ASCII tokens like "ON", "OFF", "GPT-5.5", "IPA", "HTTPS", "Safari", "Chrome" unchanged.
- Do NOT add quotes, comments, or extra text. Preserve the meaning and tone (friendly, succinct).
- If a string is already language-neutral (e.g. just a symbol), return it unchanged.

Return STRICT JSON of the form {"translations":{"<original English>":"<translated>", ...}} containing EXACTLY the input strings as keys, each mapped to its translation. Output JSON only.`;

export async function POST(request: NextRequest) {
  const apiKey = process.env.OPENAI_API_KEY;

  let body: TranslateBody = {};
  try {
    body = (await request.json()) as TranslateBody;
  } catch {
    // fall through
  }

  const lang = typeof body.lang === "string" ? body.lang : "";
  const items = Array.isArray(body.items)
    ? body.items.filter((x): x is string => typeof x === "string" && x.length > 0)
    : [];

  // Graceful no-op: empty map → the client keeps showing English.
  const empty = () => Response.json({ translations: {} });

  if (!apiKey || !lang || lang === "en" || items.length === 0) return empty();

  const languageName = getLanguage(lang).label || lang;
  const userMsg = `Target language: ${languageName} (code: ${lang}).\nTranslate these ${items.length} UI strings:\n${JSON.stringify(items)}`;

  try {
    const res = await fetch(CHAT_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: MODEL,
        reasoning_effort: "low",
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: SYSTEM },
          { role: "user", content: userMsg },
        ],
      }),
    });

    if (!res.ok) return empty();

    const data: unknown = await res.json().catch(() => null);
    const content = extractContent(data);
    if (!content) return empty();

    let parsed: { translations?: unknown };
    try {
      parsed = JSON.parse(content);
    } catch {
      return empty();
    }

    const raw = parsed.translations;
    if (!raw || typeof raw !== "object") return empty();

    // Keep only valid string→string pairs for strings we actually asked for.
    const want = new Set(items);
    const translations: Record<string, string> = {};
    for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
      if (want.has(k) && typeof v === "string" && v.trim()) translations[k] = v;
    }
    return Response.json({ translations });
  } catch {
    return empty();
  }
}

function extractContent(data: unknown): string | null {
  if (!data || typeof data !== "object") return null;
  const choices = (data as { choices?: unknown }).choices;
  if (!Array.isArray(choices) || choices.length === 0) return null;
  const msg = (choices[0] as { message?: { content?: unknown } }).message;
  const content = msg?.content;
  return typeof content === "string" ? content : null;
}
