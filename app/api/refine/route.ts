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
  /**
   * Index into `lines` where the lines that should actually be re-edited begin.
   * Everything before it is read-only context. Defaults to 0 (edit all), which
   * keeps the old "optimize the whole conversation" behaviour.
   */
  optimizeFrom?: number;
}

const SYSTEM = `You are a meticulous editor for a live, two-way interpreted conversation. You are given a short window of consecutive lines. Each line has a raw transcription ("source", in the language it was spoken) and a raw machine translation ("target"), and is tagged either [CTX] (already-finalized context — do NOT change, shown only for reference) or [EDIT] (to correct now). Raw lines can contain speech-recognition mistakes, wrong word boundaries, dropped words, numbers/names heard wrong, or awkward phrasing.

Using the whole window as context, re-edit ONLY the [EDIT] lines. For EACH [EDIT] line output the corrected transcription and the most natural, accurate translation, keeping terminology, names, numbers, pronouns and tone consistent with the context.

Return STRICT JSON of the form {"lines":[{"source":"...","target":"..."}, ...]} containing EXACTLY the [EDIT] lines, in the same order. For each line keep "source" in its original spoken language (do NOT translate it) and put the translation in "target" in that line's target language. If a line is already correct, return it unchanged. Output JSON only, no commentary.`;

export async function POST(request: NextRequest) {
  const apiKey = process.env.OPENAI_API_KEY;

  let body: RefineBody = {};
  try {
    body = (await request.json()) as RefineBody;
  } catch {
    // fall through
  }
  const lines = Array.isArray(body.lines) ? body.lines : [];
  const fromRaw =
    typeof body.optimizeFrom === "number" ? Math.floor(body.optimizeFrom) : 0;
  const from = Math.min(Math.max(0, fromRaw), lines.length);
  const targets = lines.slice(from);

  // Graceful no-op: return the edit targets unchanged so the UI keeps its text.
  const fallback = () =>
    Response.json({
      lines: targets.map((l) => ({ source: l.source, target: l.target })),
    });

  if (!apiKey || targets.length === 0) return fallback();

  const convo = lines
    .map((l, i) =>
      [
        `#${i + 1} ${i < from ? "[CTX]" : "[EDIT]"} (${l.sourceLang ?? "auto"} -> ${l.targetLang ?? "?"})`,
        `  source: ${JSON.stringify(l.source ?? "")}`,
        `  target: ${JSON.stringify(l.target ?? "")}`,
      ].join("\n"),
    )
    .join("\n");

  const userMsg = `Conversation window (${lines.length} lines, ${targets.length} to edit):\n${convo}\n\nReturn {"lines":[...]} with exactly ${targets.length} items — only the [EDIT] lines, in the same order.`;

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
    if (!Array.isArray(out) || out.length !== targets.length) return fallback();

    // Merge defensively: keep the original where the model omitted a field.
    const merged = targets.map((orig, i) => {
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
