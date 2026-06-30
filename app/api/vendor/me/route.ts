export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { getRouteUser } from "@/lib/auth/routeUser";
import { getMyVendor } from "@/lib/auth/getMyVendor";

// Replaces the browser `supabase.rpc("get_my_vendor")` gate call. Server-side,
// NextAuth-scoped, MySQL-backed.
export async function GET() {
  const user = await getRouteUser();
  if (!user) return NextResponse.json({ ok: false, vendor: null }, { status: 401 });
  const vendor = await getMyVendor(user.id);
  return NextResponse.json({ ok: true, vendor }, { headers: { "cache-control": "no-store" } });
}
