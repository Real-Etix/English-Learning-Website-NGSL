/**
 * Clip inbox endpoint (local file inbox).
 *
 * The Chrome extension POSTs { text, url, title } here; each clip is appended as
 * one JSON line to wiki/raw/inbox.jsonl. Capture only — no LLM, no processing.
 * The batch `scripts/ingest-clips.ts` drains this file and writes wiki pages.
 *
 * Runs on the local dev server only (writes to the repo filesystem), which is
 * exactly what the "local file inbox" design intends.
 */
import { appendFile, mkdir } from "node:fs/promises";
import path from "node:path";

export const runtime = "nodejs";

const INBOX_PATH = path.join(process.cwd(), "wiki", "raw", "inbox.jsonl");

// Chrome extensions with host_permissions bypass CORS, but permissive headers
// keep local testing (curl, other tools) frictionless.
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS });
}

export async function POST(request: Request) {
  let body: { text?: string; url?: string; title?: string };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "invalid JSON" }, { status: 400, headers: CORS });
  }

  const text = (body.text ?? "").trim();
  if (!text) {
    return Response.json({ error: "missing text" }, { status: 400, headers: CORS });
  }

  const clip = {
    text,
    url: body.url ?? "",
    title: body.title ?? "",
    clippedAt: new Date().toISOString(),
  };

  await mkdir(path.dirname(INBOX_PATH), { recursive: true });
  await appendFile(INBOX_PATH, `${JSON.stringify(clip)}\n`, "utf8");

  return Response.json({ ok: true, chars: text.length }, { status: 201, headers: CORS });
}
