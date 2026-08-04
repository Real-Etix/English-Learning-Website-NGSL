import { cookies } from "next/headers";

import { getMySummary } from "@/lib/collection/service";

export const runtime = "nodejs";

export async function GET() {
  const token = (await cookies()).get("ownerToken")?.value;
  return Response.json({ me: await getMySummary(token) });
}
