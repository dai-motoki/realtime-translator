import type { NextRequest } from "next/server";

export const dynamic = "force-dynamic";

const CHAT_URL = "https://api.openai.com/v1/chat/completions";
// A normal text model is plenty for cleanup; override via env if desired.
const MODEL = process.env.REFINE_MODEL || "gpt-5.5";

interface Line {
  source: string;
  target: string;
  sourceLang?: string | null;
  targetLang?: string | null;
}
interface RefineBody {
  lines?: Line[];
}

const SYSTEM = `You are a meticulous editor for a live, two-way interpreted conversation. Below is the ENTIRE conversation as captured in real time. Each line has a raw transcription ("source", in the language it was spoken) and a raw machine translation ("target"). These can contain speech-recognition mistakes, wrong word boundaries, dropped words, numbers/names heard wrong, or awkward phrasing.

Re-edit the WHOLE conversation using the full context. For EACH line, output the corrected transcription and the most natural, accurate translation, keeping terminology, names, numbers, pronouns and tone consistent across the entire conversation.

Return STRICT JSON of the form {"lines":[{"source":"...","target":"..."}, ...]} with EXACTLY the same number of lines, in the same order as given. For each line keep "source" in its original spoken language (do NOT translate it) and put the translation in "target" in that line's target language. If a line is already correct, return it unchanged. Output JSON only, no commentary.`;

export async function POST(request: NextRequest) {
  const apiKey = process.env.OPENAI_API_KEY;

  let body: RefineBody = {};
  try {
    body = (await request.json()) as RefineBody;
  } catch {
    // fall through
  }
  const lines = Array.isArray(body.lines) ? body.lines : [];

  // Graceful no-op: return the input lines unchanged so the UI keeps its text.
  const fallback = () =>
    Response.json({
      lines: lines.map((l) => ({ source: l.source, target: l.target })),
    });

  if (!apiKey || lines.length === 0) return fallback();

  const convo = lines
    .map((l, i) =>
      [
        `#${i + 1} (${l.sourceLang ?? "auto"} -> ${l.targetLang ?? "?"})`,
        `  source: ${JSON.stringify(l.source ?? "")}`,
        `  target: ${JSON.stringify(l.target ?? "")}`,
      ].join("\n"),
    )
    .join("\n");

  const userMsg = `Conversation (${lines.length} lines):\n${convo}\n\nReturn {"lines":[...]} with exactly ${lines.length} items in the same order.`;

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

    let parsed: { lines?: unknown };
    try {
      parsed = JSON.parse(content);
    } catch {
      return fallback();
    }

    const out = parsed.lines;
    if (!Array.isArray(out) || out.length !== lines.length) return fallback();

    // Merge defensively: keep the original where the model omitted a field.
    const merged = lines.map((orig, i) => {
      const r = out[i] as { source?: unknown; target?: unknown } | undefined;
      return {
        source: typeof r?.source === "string" ? r.source : orig.source,
        target: typeof r?.target === "string" ? r.target : orig.target,
      };
    });
    return Response.json({ lines: merged });
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
