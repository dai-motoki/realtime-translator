import type { NextRequest } from "next/server";
import { getLanguage } from "@/lib/languages";

export const dynamic = "force-dynamic";

const CHAT_URL = "https://api.openai.com/v1/chat/completions";
const MODEL =
  process.env.TRANSLATE_MODEL || process.env.REFINE_MODEL || "gpt-5.5";

// Sentinel between consecutive translations (mirrors ainewsblitz's segment
// streaming). UI strings never contain it, so we can split the model's output
// as it streams and emit each finished translation immediately.
const SEP = "[[===SEG===]]";

interface Body {
  lang?: string;
  items?: unknown;
}

const SYSTEM = `You localize short UI strings. You are given English strings separated by the exact delimiter ${SEP}. Translate EACH into the target language and output ONLY the translations, in the SAME order, separated by the exact delimiter ${SEP} between consecutive translations (do NOT put it before the first or after the last).

Rules:
- Keep placeholders in curly braces ({app}, {n}) EXACTLY as-is.
- Keep emoji, arrows (→), and ASCII tokens like ON, OFF, GPT-5.5, IPA, HTTPS, Safari, Chrome unchanged.
- Natural, concise app phrasing. No numbering, no quotes, no commentary.`;

export async function POST(request: NextRequest) {
  const apiKey = process.env.OPENAI_API_KEY;

  let body: Body = {};
  try {
    body = (await request.json()) as Body;
  } catch {
    // fall through
  }
  const lang = typeof body.lang === "string" ? body.lang : "";
  const items = Array.isArray(body.items)
    ? body.items.filter((x): x is string => typeof x === "string" && x.length > 0)
    : [];

  if (!apiKey || !lang || lang === "en" || items.length === 0) {
    // Nothing to stream — the client keeps English. (204 must have a null body.)
    return new Response(null, { status: 204 });
  }

  const languageName = getLanguage(lang).label || lang;
  const userMsg = `Target language: ${languageName} (code: ${lang}).\n\nStrings:\n${items.join(`\n${SEP}\n`)}`;

  let upstream: Response;
  try {
    upstream = await fetch(CHAT_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: MODEL,
        reasoning_effort: "low",
        stream: true,
        messages: [
          { role: "system", content: SYSTEM },
          { role: "user", content: userMsg },
        ],
      }),
    });
  } catch {
    return new Response("", { status: 502 });
  }
  if (!upstream.ok || !upstream.body) return new Response("", { status: 502 });

  const encoder = new TextEncoder();
  const decoder = new TextDecoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const reader = upstream.body!.getReader();
      let sseBuf = ""; // raw upstream SSE buffer
      let acc = ""; // accumulated assistant text
      let idx = 0;

      const send = (obj: unknown) =>
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(obj)}\n\n`));

      // Emit every completed segment (done) and, for the in-progress one, its
      // growing partial text — so the client reveals it character by character.
      const pump = () => {
        let p: number;
        while ((p = acc.indexOf(SEP)) >= 0) {
          const seg = acc.slice(0, p).trim();
          acc = acc.slice(p + SEP.length);
          if (idx < items.length) send({ i: idx, text: seg, done: true });
          idx += 1;
        }
        const partial = acc.replace(/^\s+/, "");
        if (partial && idx < items.length) {
          send({ i: idx, text: partial, done: false });
        }
      };

      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          sseBuf += decoder.decode(value, { stream: true });
          let nl: number;
          while ((nl = sseBuf.indexOf("\n")) >= 0) {
            const line = sseBuf.slice(0, nl).trim();
            sseBuf = sseBuf.slice(nl + 1);
            if (!line.startsWith("data:")) continue;
            const data = line.slice(5).trim();
            if (!data || data === "[DONE]") continue;
            try {
              const j = JSON.parse(data) as {
                choices?: { delta?: { content?: string } }[];
              };
              const delta = j.choices?.[0]?.delta?.content;
              if (typeof delta === "string") {
                acc += delta;
                pump();
              }
            } catch {
              // ignore non-JSON keepalive lines
            }
          }
        }
        const last = acc.trim();
        if (last && idx < items.length) send({ i: idx, text: last, done: true });
        send({ done: true });
      } catch {
        // upstream interrupted — close with what we have
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
