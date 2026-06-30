export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { getRouteVendor } from "@/lib/auth/getRouteVendor";
import { prisma } from "@/lib/db/prisma";
import { jsonSafe } from "@/lib/db/serialize";

const json = (d: any, s = 200) =>
  NextResponse.json(d, { status: s, headers: { "cache-control": "no-store" } });

// Vendor brand catalog reads. Replaces the browser
// `supabase.from("brands").select(...)` calls.
//   - default: brand options for filter dropdowns -> { id, name } ordered by name.
//   - ?id=<brandId>: single brand (id,name,brand_code) for the UnitUpsert dialog.
// Brands are a shared global catalog (no vendor_id column), so no vendor scoping
// is possible/needed on the rows — but the endpoint is still auth-gated so only
// a logged-in approved vendor can read it.
export async function GET(req: Request) {
  const ctx = await getRouteVendor();
  if (!ctx) return json({ ok: false, error: "UNAUTHORIZED" }, 401);

  try {
    const id = new URL(req.url).searchParams.get("id");
    if (id) {
      const brand = await prisma.brands.findUnique({
        where: { id },
        select: { id: true, name: true, brand_code: true },
      });
      return json({ ok: true, data: jsonSafe(brand) });
    }

    const data = await prisma.brands.findMany({
      select: { id: true, name: true, slug: true },
      orderBy: { name: "asc" },
    });
    return json({ ok: true, data: jsonSafe(data) });
  } catch (e: any) {
    return json({ ok: false, error: e?.message || "READ_FAILED" }, 500);
  }
}
