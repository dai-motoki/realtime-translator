import type { NextRequest } from "next/server";

// Route Handlers are not cached by default; mark dynamic to be explicit since
// this mints a fresh, short-lived credential on every request.
export const dynamic = "force-dynamic";

const CLIENT_SECRET_URL =
  "https://api.openai.com/v1/realtime/translations/client_secrets";

interface SessionBody {
  outputLanguage?: string;
}

/**
 * Mints a short-lived client secret for the OpenAI Realtime *translation* API.
 * The standard API key never leaves the server — the browser only ever sees the
 * single-use ephemeral secret returned here.
 */
export async function POST(request: NextRequest) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return Response.json(
      { error: "OPENAI_API_KEY is not configured on the server." },
      { status: 500 },
    );
  }

  let body: SessionBody = {};
  try {
    body = (await request.json()) as SessionBody;
  } catch {
    // empty / invalid body is fine — fall back to the default below
  }
  const outputLanguage = body.outputLanguage ?? "en";

  let upstream: Response;
  try {
    upstream = await fetch(CLIENT_SECRET_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        session: {
          model: "gpt-realtime-translate",
          audio: {
            input: {
              transcription: { model: "gpt-realtime-whisper" },
              noise_reduction: { type: "near_field" },
            },
            output: { language: outputLanguage },
          },
        },
      }),
    });
  } catch (err) {
    return Response.json(
      {
        error: "Could not reach the OpenAI API.",
        details: err instanceof Error ? err.message : String(err),
      },
      { status: 502 },
    );
  }

  const data: unknown = await upstream.json().catch(() => ({}));

  if (!upstream.ok) {
    return Response.json(
      { error: extractError(data) ?? "Failed to create a translation session." },
      { status: upstream.status },
    );
  }

  const clientSecret = extractSecret(data);
  if (!clientSecret) {
    return Response.json(
      { error: "OpenAI did not return a client secret." },
      { status: 502 },
    );
  }

  return Response.json({ clientSecret });
}

// The translation endpoint's response shape is normalised here so the client
// stays simple regardless of whether the secret arrives nested or flat.
function extractSecret(data: unknown): string | null {
  if (!data || typeof data !== "object") return null;
  const d = data as Record<string, unknown>;
  const cs = d.client_secret;
  if (typeof cs === "string") return cs;
  if (cs && typeof cs === "object") {
    const v = (cs as Record<string, unknown>).value;
    if (typeof v === "string") return v;
  }
  if (typeof d.value === "string") return d.value;
  return null;
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
