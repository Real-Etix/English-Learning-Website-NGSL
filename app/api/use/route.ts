import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { markWordUsed } from "@/lib/collection/service";
import { loadGeneratedWord } from "@/lib/vocabulary/generated-word-store";
import { needsExampleForPractice } from "@/lib/vocabulary/meaning-review";

export const runtime = "nodejs";

/**
 * Mark a held word as produced-in-a-sentence (a solid star). Called after the
 * composition grader passes. Server-authoritative: it stamps `usedAt` and awards
 * the one-time bonus, so solid stars persist and can decay after 60 days.
 */
export async function POST(request: Request) {
  const token = (await cookies()).get("ownerToken")?.value;
  if (!token) return NextResponse.json({ error: "no space yet" }, { status: 401 });

  let body: { lemma?: string; senseId?: string };
  try { body = await request.json(); } catch { return NextResponse.json({ error: "invalid request" }, { status: 400 }); }
  const lemma = String(body.lemma ?? "").trim();
  if (!lemma) return NextResponse.json({ error: "no lemma" }, { status: 400 });

  const record = await loadGeneratedWord(lemma);
  const sense = body.senseId === undefined
    ? record?.senses.find(candidate => candidate.status === "published")
    : record?.senses.find(candidate => candidate.id === body.senseId);
  if (!record || record.publicationStatus !== "published" || !sense || sense.status !== "published") {
    return NextResponse.json({ error: "This meaning is not available for practice." }, { status: 409 });
  }
  if (needsExampleForPractice(record, sense)) {
    return NextResponse.json({ error: "Sentence practice needs a reviewed, sourced example." }, { status: 409 });
  }

  const result = await markWordUsed(token, lemma);
  if ("error" in result) return NextResponse.json(result, { status: 404 });
  return NextResponse.json(result);
}
