import { cookies } from "next/headers";

import { getMySummary, renameCollection, resetCollection } from "@/lib/collection/service";

export const runtime = "nodejs";

export async function GET() {
  const token = (await cookies()).get("ownerToken")?.value;
  return Response.json({ me: await getMySummary(token) });
}

// Rename your space.
export async function PATCH(request: Request) {
  const token = (await cookies()).get("ownerToken")?.value;
  if (!token) return Response.json({ error: "no space" }, { status: 400 });
  const body = (await request.json().catch(() => ({}))) as { displayName?: string };
  await renameCollection(token, String(body.displayName ?? ""));
  return Response.json({ me: await getMySummary(token) });
}

// Reset (empty) your space.
export async function DELETE() {
  const token = (await cookies()).get("ownerToken")?.value;
  if (!token) return Response.json({ error: "no space" }, { status: 400 });
  await resetCollection(token);
  return Response.json({ me: await getMySummary(token) });
}
