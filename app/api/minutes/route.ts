import type { NextRequest } from "next/server";
import { getLanguage } from "@/lib/languages";

export const dynamic = "force-dynamic";

const CHAT_URL = "https://api.openai.com/v1/chat/completions";
const MODEL =
  process.env.MINUTES_MODEL || process.env.REFINE_MODEL || "gpt-5.5";

interface InTarget {
  lang?: string;
  target?: string;
}
interface InLine {
  source?: string;
  sourceLang?: string | null;
  targets?: InTarget[];
}
interface MinutesBody {
  lines?: InLine[];
  /** Language code the minutes should be written in (the reader's language). */
  lang?: string;
}

function systemPrompt(langName: string): string {
  return `You are a precise meeting-minutes writer. You receive a real, multi-language conversation that was interpreted live: each line has what was spoken ("source", in its own language) plus machine translations into the other languages. Treat the whole thing as a single meeting/conversation, regardless of which language each line is in.

Write concise, faithful minutes (議事録) of this conversation. Do NOT invent facts that were not discussed; if a section has nothing, return an empty array (or empty string for the summary).

Return STRICT JSON of exactly this shape:
{
  "title": "a short, descriptive title for this conversation",
  "summary": "a 1-3 sentence overview of what the conversation was about",
  "topics": ["the main points / topics discussed, one per item"],
  "decisions": ["any decisions, agreements or conclusions reached"],
  "actions": ["action items / next steps / to-dos, including who is responsible when stated"]
}

Write ALL of the text (title, summary, topics, decisions, actions) in ${langName}, no matter which languages were spoken. Keep each list item short (one line). Output JSON only, no commentary.`;
}

export async function POST(request: NextRequest) {
  const apiKey = process.env.OPENAI_API_KEY;

  let body: MinutesBody = {};
  try {
    body = (await request.json()) as MinutesBody;
  } catch {
    // fall through to validation
  }
  const lines = Array.isArray(body.lines) ? body.lines : [];
  if (lines.length === 0) {
    return Response.json(
      { error: "会話がまだありません。" },
      { status: 400 },
    );
  }
  if (!apiKey) {
    return Response.json(
      { error: "OPENAI_API_KEY is not configured on the server." },
      { status: 500 },
    );
  }

  const lang = typeof body.lang === "string" && body.lang ? body.lang : "ja";
  const langName = getLanguage(lang).label || "Japanese";

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

  const userMsg = `Conversation (${lines.length} lines):\n${convo}\n\nWrite the minutes as specified, in ${langName}.`;

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
        { error: "議事録の生成に失敗しました。少し待って再度お試しください。" },
        { status: 502 },
      );
    }

    const data: unknown = await res.json().catch(() => null);
    const content = extractContent(data);
    if (!content) {
      return Response.json(
        { error: "議事録の生成に失敗しました。" },
        { status: 502 },
      );
    }

    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(content) as Record<string, unknown>;
    } catch {
      return Response.json(
        { error: "議事録の生成に失敗しました。" },
        { status: 502 },
      );
    }

    return Response.json({
      title: str(parsed.title),
      summary: str(parsed.summary),
      topics: strList(parsed.topics),
      decisions: strList(parsed.decisions),
      actions: strList(parsed.actions),
      lang,
    });
  } catch {
    return Response.json(
      { error: "議事録の生成中にエラーが発生しました。" },
      { status: 502 },
    );
  }
}

function str(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

function strList(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.map(str).filter(Boolean);
}

function extractContent(data: unknown): string | null {
  if (!data || typeof data !== "object") return null;
  const choices = (data as { choices?: unknown }).choices;
  if (!Array.isArray(choices) || choices.length === 0) return null;
  const msg = (choices[0] as { message?: { content?: unknown } }).message;
  const content = msg?.content;
  return typeof content === "string" ? content : null;
}
