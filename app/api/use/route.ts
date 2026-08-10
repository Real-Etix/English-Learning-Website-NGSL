import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { markWordUsed } from "@/lib/collection/service";

export const runtime = "nodejs";

/**
 * Mark a held word as produced-in-a-sentence (a solid star). Called after the
 * composition grader passes. Server-authoritative: it stamps `usedAt` and awards
 * the one-time bonus, so solid stars persist and can decay after 60 days.
 */
export async function POST(request: Request) {
  const token = (await cookies()).get("ownerToken")?.value;
  if (!token) return NextResponse.json({ error: "no space yet" }, { status: 401 });

  let body: { lemma?: string };
  try { body = await request.json(); } catch { return NextResponse.json({ error: "invalid request" }, { status: 400 }); }
  const lemma = String(body.lemma ?? "").trim();
  if (!lemma) return NextResponse.json({ error: "no lemma" }, { status: 400 });

  const result = await markWordUsed(token, lemma);
  if ("error" in result) return NextResponse.json(result, { status: 404 });
  return NextResponse.json(result);
}
