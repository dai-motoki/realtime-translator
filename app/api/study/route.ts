import type { NextRequest } from "next/server";
import { getLanguage } from "@/lib/languages";

export const dynamic = "force-dynamic";

const CHAT_URL = "https://api.openai.com/v1/chat/completions";
const MODEL = process.env.STUDY_MODEL || process.env.REFINE_MODEL || "gpt-5.5";

interface InTarget {
  lang?: string;
  target?: string;
}
interface InLine {
  source?: string;
  sourceLang?: string | null;
  targets?: InTarget[];
}
interface StudyBody {
  lines?: InLine[];
  /** The learner's language — meanings/explanations are written in it. */
  lang?: string;
}

function systemPrompt(langName: string): string {
  return `You are a friendly language tutor for a learner who reads ${langName}. You receive a real multilingual conversation: each line has what was spoken ("source", with its language code) and its translations into the other languages. The learner is practising the languages in the conversation.

From this conversation, produce personalised study material:

1. "vocab": the most useful words and short phrases worth memorising, taken from the languages actually used (other than ${langName}). For each item give:
   - "term": the word/phrase in its own language
   - "lang": its language code (e.g. "en", "zh")
   - "reading": a pronunciation guide (IPA for English/European languages, Hanyu Pinyin with tone marks for Chinese, Revised Romanization for Korean, standard romanization otherwise)
   - "meaning": a concise meaning written in ${langName}
   - "example": the example sentence from the conversation that uses it (in its own language); omit if none fits
   - "exampleLocal": that same example sentence translated into ${langName} (omit if there's no example)
   - "exampleReading": a pronunciation guide for the WHOLE example sentence, same style as "reading" (IPA for English/European, Hanyu Pinyin with tone marks for Chinese, Revised Romanization for Korean, romaji for Japanese, standard romanization otherwise); omit if there's no example
   Pick 6–12 genuinely useful items, skipping trivial words (the, a, is …). Prefer phrases/collocations the learner would want to reuse.

2. "grammar": a few (3–6) basic grammar points illustrated by the conversation's sentences. For each item give:
   - "title": a short name for the point, written in ${langName}
   - "lang": the language code it applies to
   - "explanation": a clear, short explanation in ${langName} of how it works
   - "example": an example sentence from the conversation (in its own language)
   - "exampleLocal": that same example sentence translated into ${langName} (omit if there's no example)
   - "exampleReading": a pronunciation guide for the WHOLE example sentence, same style as the vocab "reading" (omit if there's no example)

Return STRICT JSON: {"vocab":[{"term","lang","reading","meaning","example","exampleLocal","exampleReading"}],"grammar":[{"title","lang","explanation","example","exampleLocal","exampleReading"}]}. All explanations and meanings in ${langName}. Output JSON only, no commentary.`;
}

export async function POST(request: NextRequest) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return Response.json(
      { error: "OPENAI_API_KEY is not configured on the server." },
      { status: 500 },
    );
  }

  let body: StudyBody = {};
  try {
    body = (await request.json()) as StudyBody;
  } catch {
    // fall through to validation
  }
  const lines = Array.isArray(body.lines) ? body.lines : [];
  if (lines.length === 0) {
    return Response.json(
      { error: "There’s no conversation yet. Talk a little first, then generate." },
      { status: 400 },
    );
  }

  const lang = typeof body.lang === "string" && body.lang ? body.lang : "en";
  const langName = getLanguage(lang).label || "English";

  const convo = lines
    .map((l, i) => {
      const head = `#${i + 1} (spoken: ${l.sourceLang ?? "auto"})`;
      const src = `  ${l.sourceLang ?? "src"}: ${JSON.stringify(l.source ?? "")}`;
      const tg = (Array.isArray(l.targets) ? l.targets : [])
        .map((t) => `  ${t.lang ?? "?"}: ${JSON.stringify(t.target ?? "")}`)
        .join("\n");
      return tg ? `${head}\n${src}\n${tg}` : `${head}\n${src}`;
    })
    .join("\n");

  const userMsg = `Conversation (${lines.length} lines):\n${convo}\n\nProduce the study material as specified.`;

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
          { role: "system", content: systemPrompt(langName) },
          { role: "user", content: userMsg },
        ],
      }),
    });

    if (!res.ok) {
      return Response.json(
        { error: "Failed to generate study material." },
        { status: 502 },
      );
    }

    const data: unknown = await res.json().catch(() => null);
    const content = extractContent(data);
    if (!content) {
      return Response.json({ vocab: [], grammar: [] });
    }

    let parsed: { vocab?: unknown; grammar?: unknown };
    try {
      parsed = JSON.parse(content);
    } catch {
      return Response.json({ vocab: [], grammar: [] });
    }

    return Response.json({
      vocab: normalizeVocab(parsed.vocab),
      grammar: normalizeGrammar(parsed.grammar),
    });
  } catch {
    return Response.json(
      { error: "Failed to generate study material." },
      { status: 502 },
    );
  }
}

function str(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

function normalizeVocab(v: unknown): unknown[] {
  if (!Array.isArray(v)) return [];
  return v
    .map((raw) => {
      const o = (raw ?? {}) as Record<string, unknown>;
      return {
        term: str(o.term),
        lang: str(o.lang),
        reading: str(o.reading),
        meaning: str(o.meaning),
        example: str(o.example),
        exampleLocal: str(o.exampleLocal),
        exampleReading: str(o.exampleReading),
      };
    })
    .filter((x) => x.term && x.meaning);
}

function normalizeGrammar(v: unknown): unknown[] {
  if (!Array.isArray(v)) return [];
  return v
    .map((raw) => {
      const o = (raw ?? {}) as Record<string, unknown>;
      return {
        title: str(o.title),
        lang: str(o.lang),
        explanation: str(o.explanation),
        example: str(o.example),
        exampleLocal: str(o.exampleLocal),
        exampleReading: str(o.exampleReading),
      };
    })
    .filter((x) => x.title && x.explanation);
}

function extractContent(data: unknown): string | null {
  if (!data || typeof data !== "object") return null;
  const choices = (data as { choices?: unknown }).choices;
  if (!Array.isArray(choices) || choices.length === 0) return null;
  const msg = (choices[0] as { message?: { content?: unknown } }).message;
  const content = msg?.content;
  return typeof content === "string" ? content : null;
}
