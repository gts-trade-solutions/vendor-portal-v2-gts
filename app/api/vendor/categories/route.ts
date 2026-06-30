export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { getRouteVendor } from "@/lib/auth/getRouteVendor";
import { prisma } from "@/lib/db/prisma";
import { jsonSafe } from "@/lib/db/serialize";

const json = (d: any, s = 200) =>
  NextResponse.json(d, { status: s, headers: { "cache-control": "no-store" } });

// Vendor category catalog reads. Replaces the browser
// `supabase.from("categories").select("id,slug,name")` call in ProductEditor.
// Categories are a shared global catalog (no vendor_id column), so no vendor
// scoping is possible/needed on the rows — but the endpoint is still auth-gated
// so only a logged-in approved vendor can read it.
export async function GET() {
  const ctx = await getRouteVendor();
  if (!ctx) return json({ ok: false, error: "UNAUTHORIZED" }, 401);

  try {
    const data = await prisma.categories.findMany({
      select: { id: true, slug: true, name: true },
      orderBy: { name: "asc" },
    });
    return json({ ok: true, data: jsonSafe(data) });
  } catch (e: any) {
    return json({ ok: false, error: e?.message || "READ_FAILED" }, 500);
  }
}
