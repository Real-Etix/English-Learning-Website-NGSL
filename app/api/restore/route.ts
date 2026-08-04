import { NextResponse } from "next/server";

import { tokenHasCollection } from "@/lib/collection/service";
import { clientIp, rateLimit } from "@/lib/rate-limit";

export const runtime = "nodejs";

const YEAR = 60 * 60 * 24 * 365;

export async function POST(request: Request) {
  // Guard against brute-forcing keys (they're UUIDs, but be safe anyway).
  const limit = rateLimit(`restore:${clientIp(request)}`, 10, 60_000);
  if (!limit.ok) {
    return NextResponse.json({ error: "Too many attempts — wait a moment." }, { status: 429 });
  }

  const body = (await request.json().catch(() => ({}))) as { key?: string };
  const key = String(body.key ?? "").trim();
  if (!key || !(await tokenHasCollection(key))) {
    return NextResponse.json({ error: "That recovery key doesn't match any space." }, { status: 404 });
  }

  const res = NextResponse.json({ ok: true });
  res.cookies.set("ownerToken", key, { httpOnly: true, sameSite: "lax", path: "/", maxAge: YEAR });
  return res;
}
