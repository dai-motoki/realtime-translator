import type { NextRequest } from "next/server";

export const dynamic = "force-dynamic";

const CHAT_URL = "https://api.openai.com/v1/chat/completions";
// A normal text model is plenty for cleanup; override via env if desired.
const MODEL = process.env.REFINE_MODEL || "gpt-5.5";

interface Line {
  source: string;
  target: string;
}
interface RefineBody {
  history?: Line[];
  current?: Line;
  sourceLang?: string | null;
  targetLang?: string;
}

const SYSTEM = `You are a meticulous editor for a live, two-way interpreted conversation. The transcription and machine translation below were produced in real time and may contain speech-recognition mistakes, wrong word boundaries, dropped words, or awkward phrasing.

You are given the conversation so far (for context) and the latest line's raw transcription ("source", in the spoken language) and its machine translation ("target").

Return a corrected, natural version of ONLY the latest line as strict JSON:
{"source":"<corrected transcription, in the SAME language as the input source — do NOT translate it>","target":"<the most natural, accurate translation of the corrected source into the target language, consistent with the conversation's terminology, names, numbers and tone>"}

Rules:
- Use the conversation context to fix homophones, names, numbers, and missing words.
- Keep "source" in its original spoken language; keep "target" in the target language.
- If the line is already fine, return it as-is.
- Output JSON only, no commentary.`;

export async function POST(request: NextRequest) {
  const apiKey = process.env.OPENAI_API_KEY;

  let body: RefineBody = {};
  try {
    body = (await request.json()) as RefineBody;
  } catch {
    // fall through with empty body
  }
  const current = body.current ?? { source: "", target: "" };

  // Graceful no-op: if we can't refine, return the original so the UI keeps
  // the real-time text instead of breaking.
  const fallback = () =>
    Response.json({ source: current.source, target: current.target });

  if (!apiKey || (!current.source && !current.target)) {
    return fallback();
  }

  const history = (body.history ?? [])
    .slice(-20)
    .map(
      (l, i) =>
        `${i + 1}. [${l.source ?? ""}] => [${l.target ?? ""}]`,
    )
    .join("\n");

  const userMsg = [
    `Source language: ${body.sourceLang ?? "auto-detect"}`,
    `Target language: ${body.targetLang ?? "unknown"}`,
    "",
    "Conversation so far:",
    history || "(none)",
    "",
    "Latest line (raw, to correct):",
    `source: ${JSON.stringify(current.source)}`,
    `target: ${JSON.stringify(current.target)}`,
  ].join("\n");

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

    if (!res.ok) return fallback();

    const data: unknown = await res.json().catch(() => null);
    const content = extractContent(data);
    if (!content) return fallback();

    let parsed: { source?: unknown; target?: unknown };
    try {
      parsed = JSON.parse(content);
    } catch {
      return fallback();
    }

    return Response.json({
      source: typeof parsed.source === "string" ? parsed.source : current.source,
      target: typeof parsed.target === "string" ? parsed.target : current.target,
    });
  } catch {
    return fallback();
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
