import type { NextRequest } from "next/server";

export const dynamic = "force-dynamic";

const SPEECH_URL = "https://api.openai.com/v1/audio/speech";
// Instruction-following TTS so we can nudge it toward the right language/tone.
const MODEL = process.env.TTS_MODEL || "gpt-4o-mini-tts";
const VOICE = process.env.TTS_VOICE || "alloy";

interface SpeakBody {
  text?: string;
  /** Human-readable language name (e.g. "Japanese") used to steer pronunciation. */
  language?: string;
}

// Guard against accidental huge payloads hitting the TTS API.
const MAX_CHARS = 2000;

/**
 * Turns a finalized transcript/translation line into spoken audio on demand, so
 * the user can replay any line by tapping it. The OpenAI key stays server-side;
 * the browser receives only the rendered MP3 stream.
 */
export async function POST(request: NextRequest) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return Response.json(
      { error: "OPENAI_API_KEY is not configured on the server." },
      { status: 500 },
    );
  }

  let body: SpeakBody = {};
  try {
    body = (await request.json()) as SpeakBody;
  } catch {
    // fall through to validation below
  }

  const text = (body.text ?? "").trim().slice(0, MAX_CHARS);
  if (!text) {
    return Response.json({ error: "No text to speak." }, { status: 400 });
  }

  const instructions = body.language
    ? `Read the text aloud naturally in ${body.language}, at a calm, clear pace.`
    : "Read the text aloud naturally, at a calm, clear pace.";

  let upstream: Response;
  try {
    upstream = await fetch(SPEECH_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: MODEL,
        voice: VOICE,
        input: text,
        instructions,
        response_format: "mp3",
      }),
    });
  } catch (err) {
    return Response.json(
      {
        error: "Could not reach the OpenAI TTS API.",
        details: err instanceof Error ? err.message : String(err),
      },
      { status: 502 },
    );
  }

  if (!upstream.ok || !upstream.body) {
    const data: unknown = await upstream.json().catch(() => null);
    const msg = extractError(data) ?? "Failed to synthesize speech.";
    return Response.json({ error: msg }, { status: upstream.status || 502 });
  }

  // Stream the MP3 straight through to the browser.
  return new Response(upstream.body, {
    headers: {
      "Content-Type": "audio/mpeg",
      "Cache-Control": "no-store",
    },
  });
}

function extractError(data: unknown): string | null {
  if (!data || typeof data !== "object") return null;
  const err = (data as Record<string, unknown>).error;
  if (typeof err === "string") return err;
  if (err && typeof err === "object") {
    const m = (err as Record<string, unknown>).message;
    if (typeof m === "string") return m;
  }
  return null;
}
