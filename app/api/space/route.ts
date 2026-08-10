import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { getMySummary, newOwnerToken, tokenHasCollection } from "@/lib/collection/service";

export const runtime = "nodejs";

const YEAR = 60 * 60 * 24 * 365;
const COOKIE = { httpOnly: true as const, sameSite: "lax" as const, path: "/", maxAge: YEAR };

/**
 * The "space key" is the anonymous ownerToken — there is no login, so the token
 * IS the credential. GET reveals it (minting one if absent) so it can be saved;
 * POST restores a space by adopting a pasted key on this device.
 */
export async function GET() {
  const store = await cookies();
  let token = store.get("ownerToken")?.value;
  const res = NextResponse.json({ key: token ?? "" });
  if (!token) {
    token = newOwnerToken();
    res.cookies.set("ownerToken", token, COOKIE);
    return NextResponse.json({ key: token }, { headers: res.headers });
  }
  return res;
}

export async function POST(request: Request) {
  let body: { key?: string };
  try { body = await request.json(); } catch { return NextResponse.json({ error: "invalid request" }, { status: 400 }); }
  const key = String(body.key ?? "").trim();
  if (!key) return NextResponse.json({ error: "Paste a space key first." }, { status: 400 });

  const ok = await tokenHasCollection(key).catch(() => false);
  if (!ok) return NextResponse.json({ error: "That key doesn't match any space." }, { status: 404 });

  const me = await getMySummary(key);
  const res = NextResponse.json({ ok: true, me });
  res.cookies.set("ownerToken", key, COOKIE);
  return res;
}
