import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { collectWord, getMySummary, newOwnerToken } from "@/lib/collection/service";

export const runtime = "nodejs";

const YEAR = 60 * 60 * 24 * 365;

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as { lemma?: string };
  const lemma = String(body.lemma ?? "").trim();
  if (!lemma) return NextResponse.json({ error: "missing lemma" }, { status: 400 });

  const cookieStore = await cookies();
  let token = cookieStore.get("ownerToken")?.value;
  const isNew = !token;
  if (!token) token = newOwnerToken();

  const result = await collectWord(token, lemma);
  if ("error" in result) return NextResponse.json(result, { status: 404 });

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
