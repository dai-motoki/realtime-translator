import type { NextRequest } from "next/server";
import { getLanguage } from "@/lib/languages";

export const dynamic = "force-dynamic";

const CHAT_URL = "https://api.openai.com/v1/chat/completions";
const MODEL = process.env.STUDY_MODEL || process.env.REFINE_MODEL || "gpt-5.5";

interface Body {
  term?: string;
  reading?: string;
  meaning?: string;
  example?: string;
  /** The learner's language code — the mnemonic is written in it. */
  lang?: string;
}

const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");

/**
 * Generates a single keyword/phonetic mnemonic on demand for one word, written
 * in the learner's language. Triggered per-card (not during bulk study) so it's
 * only produced when the learner asks for it.
 */
export async function POST(request: NextRequest) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return Response.json(
      { error: "OPENAI_API_KEY is not configured on the server." },
      { status: 500 },
    );
  }

  let body: Body = {};
  try {
    body = (await request.json()) as Body;
  } catch {
    // validation below
  }
  const term = str(body.term);
  if (!term) {
    return Response.json({ error: "No term." }, { status: 400 });
  }
  const reading = str(body.reading);
  const meaning = str(body.meaning);
  const example = str(body.example);
  const langName = getLanguage(str(body.lang) || "en").label || "English";

  const system = `You write vivid memory hooks (keyword/phonetic mnemonics) for language learners, WRITTEN IN ${langName}. Break the term's PRONUNCIATION into ${langName} words/sounds that form one short, vivid (even absurd) scene whose meaning connects to the term's meaning, ideally echoing the example sentence. Always use ${langName}'s own sounds and script (never assume Japanese unless ${langName} is Japanese). End with "→ <term>". For instance, a Japanese-reading learner for Chinese 日本人 (yīběnrén) = "Japanese person" might get "空港で胃(イー)に弁当(ベン)が連撃(レン)される＝日本人が日の丸弁当を食べる場面 → 日本人". Reply with ONLY the mnemonic sentence, no quotes, no commentary.`;

  const user = [
    `Term: ${term}`,
    reading && `Pronunciation: ${reading}`,
    meaning && `Meaning (${langName}): ${meaning}`,
    example && `Example: ${example}`,
  ]
    .filter(Boolean)
    .join("\n");

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
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
      }),
    });
    if (!res.ok) {
      return Response.json(
        { error: "Failed to generate the mnemonic." },
        { status: 502 },
      );
    }
    const data: unknown = await res.json().catch(() => null);
    const content = (
      data as { choices?: { message?: { content?: unknown } }[] }
    )?.choices?.[0]?.message?.content;
    const mnemonic = typeof content === "string" ? content.trim() : "";
    return Response.json({ mnemonic });
  } catch {
    return Response.json(
      { error: "Failed to generate the mnemonic." },
      { status: 502 },
    );
  }
}
