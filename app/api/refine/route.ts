import type { NextRequest } from "next/server";

export const dynamic = "force-dynamic";

const CHAT_URL = "https://api.openai.com/v1/chat/completions";
// A normal text model is plenty for cleanup; override via env if desired.
const MODEL = process.env.REFINE_MODEL || "gpt-5.5";

interface Target {
  lang?: string;
  target?: string;
}
interface Line {
  source: string;
  sourceLang?: string | null;
  /** Machine translations of this line into each other language. */
  targets?: Target[];
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

// Known proper nouns the speech recognizer often mishears. The editor below is
// told to normalise any phonetic/spelling variant to the canonical form.
const GLOSSARY = [
  'The person "Motoki Daisuke" (also heard as "もとき だいすけ", "モトキダイスケ", "Daisuke Motoki", "本木大介", etc.) → in Japanese text write the name as "元木大介"; in other languages keep it as "Motoki Daisuke".',
];

const SYSTEM = `You are a meticulous editor for a live, multi-language interpreted conversation. You are given a short window of consecutive lines. Each line has a raw transcription ("source", in the language it was spoken) and one or more raw machine "translations" into the other languages (each tagged with its language code). Each line is tagged either [CTX] (already-finalized context — do NOT change, shown only for reference) or [EDIT] (to correct now). Raw text can contain speech-recognition mistakes, wrong word boundaries, dropped words, numbers/names heard wrong, or awkward phrasing.

Using the whole window as context, re-edit ONLY the [EDIT] lines. For EACH [EDIT] line output the corrected transcription and, for EACH of that line's translations, the most natural, accurate version, keeping terminology, names, numbers, pronouns and tone consistent with the context.

Known names / glossary — apply consistently wherever they appear, in both the transcription and the translations:
${GLOSSARY.map((g) => `- ${g}`).join("\n")}

Return STRICT JSON of the form {"lines":[{"source":"...","targets":[{"lang":"xx","target":"..."}, ...]}, ...]} containing EXACTLY the [EDIT] lines, in the same order, and for each line EXACTLY the same translation languages it was given, in the same order. Keep "source" in its original spoken language (do NOT translate it). If something is already correct, return it unchanged. Output JSON only, no commentary.`;

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

  const targetsOf = (l: Line): Target[] =>
    Array.isArray(l.targets) ? l.targets : [];

  // Graceful no-op: return the edit targets unchanged so the UI keeps its text.
  const fallback = () =>
    Response.json({
      lines: targets.map((l) => ({
        source: l.source,
        targets: targetsOf(l).map((t) => ({ lang: t.lang, target: t.target })),
      })),
    });

  if (!apiKey || targets.length === 0) return fallback();

  const convo = lines
    .map((l, i) => {
      const head = `#${i + 1} ${i < from ? "[CTX]" : "[EDIT]"} (spoken: ${l.sourceLang ?? "auto"})`;
      const src = `  source: ${JSON.stringify(l.source ?? "")}`;
      const tg = targetsOf(l)
        .map(
          (t) =>
            `  target[${t.lang ?? "?"}]: ${JSON.stringify(t.target ?? "")}`,
        )
        .join("\n");
      return tg ? `${head}\n${src}\n${tg}` : `${head}\n${src}`;
    })
    .join("\n");

  const userMsg = `Conversation window (${lines.length} lines, ${targets.length} to edit):\n${convo}\n\nReturn {"lines":[...]} with exactly ${targets.length} items — only the [EDIT] lines, in the same order, each with the same translation languages it was given.`;

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

    // Merge defensively: keep the original where the model omitted a field, and
    // always return the same languages (in order) that the line came in with.
    const merged = targets.map((orig, i) => {
      const r = out[i] as
        | { source?: unknown; targets?: unknown }
        | undefined;
      const rTargets = Array.isArray(r?.targets) ? r.targets : [];
      const byLang = new Map<string, string>();
      for (const rt of rTargets) {
        const o = rt as { lang?: unknown; target?: unknown };
        if (typeof o.lang === "string" && typeof o.target === "string") {
          byLang.set(o.lang, o.target);
        }
      }
      return {
        source: typeof r?.source === "string" ? r.source : orig.source,
        targets: targetsOf(orig).map((t) => ({
          lang: t.lang,
          target:
            (t.lang != null && byLang.get(t.lang)) || t.target || "",
        })),
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
