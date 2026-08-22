import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { collectWord, getMySummary, newOwnerToken } from "@/lib/collection/service";
import { loadGeneratedWord } from "@/lib/vocabulary/generated-word-store";
import { claimReadiness } from "@/lib/vocabulary/claim-readiness";

export const runtime = "nodejs";

const YEAR = 60 * 60 * 24 * 365;

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as { lemma?: string; senseId?: string };
  const lemma = String(body.lemma ?? "").trim();
  const senseId = typeof body.senseId === "string" ? body.senseId : "";
  if (!lemma) return NextResponse.json({ error: "missing lemma" }, { status: 400 });
  if (!senseId.trim()) return NextResponse.json({ error: "missing senseId" }, { status: 400 });

  const record = await loadGeneratedWord(lemma);
  if (!record || record.lemma !== lemma) return NextResponse.json({ error: "unknown word" }, { status: 404 });
  const readiness = claimReadiness(record, senseId);
  if (!readiness.canClaim) return NextResponse.json({ error: readiness.reason }, { status: 409 });

  const cookieStore = await cookies();
  let token = cookieStore.get("ownerToken")?.value;
  const isNew = !token;
  if (!token) token = newOwnerToken();

  const result = await collectWord(token, record.lemma, senseId);
  if ("error" in result) {
    return NextResponse.json(
      result.error === "not claimable" ? { error: result.reason } : result,
      { status: result.error === "not claimable" ? 409 : 404 },
    );
  }

  const summary = await getMySummary(token);
  const res = NextResponse.json({ ...result, summary });
  if (isNew) {
    res.cookies.set("ownerToken", token, {
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      maxAge: YEAR,
    });
  }
  return res;
}
