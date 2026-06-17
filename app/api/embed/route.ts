import type { NextRequest } from "next/server";

export const dynamic = "force-dynamic";

const EMBED_URL = "https://api.openai.com/v1/embeddings";
const MODEL = process.env.EMBED_MODEL || "text-embedding-3-small";
// Shortened embeddings: plenty for similarity ranking, and far smaller to ship.
const DIMS = Number(process.env.EMBED_DIMS || 256);
// OpenAI accepts large input arrays; the client already chunks, this is a guard.
const MAX_INPUTS = 256;

interface EmbedBody {
  texts?: unknown;
}

/**
 * Batched text embeddings for the study ranking. The OpenAI key stays
 * server-side; the browser receives only the vectors. Output order matches the
 * input `texts` order (missing/failed entries come back as null).
 */
export async function POST(request: NextRequest) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return Response.json(
      { error: "OPENAI_API_KEY is not configured on the server." },
      { status: 500 },
    );
  }

  let body: EmbedBody = {};
  try {
    body = (await request.json()) as EmbedBody;
  } catch {
    // fall through to validation
  }

  const texts = (Array.isArray(body.texts) ? body.texts : [])
    .filter((t): t is string => typeof t === "string" && t.trim().length > 0)
    .slice(0, MAX_INPUTS);
  if (texts.length === 0) return Response.json({ embeddings: [] });

  try {
    const res = await fetch(EMBED_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ model: MODEL, input: texts, dimensions: DIMS }),
    });
    if (!res.ok) {
      return Response.json({ error: "Failed to embed." }, { status: 502 });
    }
    const data: unknown = await res.json().catch(() => null);
    const rows = (data as { data?: unknown })?.data;
    if (!Array.isArray(rows)) return Response.json({ embeddings: [] });

    const embeddings: (number[] | null)[] = new Array(texts.length).fill(null);
    for (const row of rows) {
      const r = row as { index?: unknown; embedding?: unknown };
      if (
        typeof r.index === "number" &&
        r.index >= 0 &&
        r.index < texts.length &&
        Array.isArray(r.embedding)
      ) {
        embeddings[r.index] = r.embedding as number[];
      }
    }
    return Response.json({ embeddings });
  } catch {
    return Response.json({ error: "Failed to embed." }, { status: 502 });
  }
}
