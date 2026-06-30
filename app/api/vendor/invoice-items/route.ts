export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { getRouteVendor } from "@/lib/auth/getRouteVendor";
import { prisma } from "@/lib/db/prisma";
import { jsonSafe } from "@/lib/db/serialize";

// Vendor-scoped read of invoice_items for one invoice. Gated behind an
// authenticated vendor. Replaces browser `supabase.from("invoice_items")` reads
// on the invoice detail / edit pages. Shape + ordering preserved.
//
//   ?invoice_id=<uuid>  (required)
export async function GET(req: NextRequest) {
  const auth = await getRouteVendor();
  if (!auth) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });

  const invoiceId = req.nextUrl.searchParams.get("invoice_id");
  if (!invoiceId) {
    return NextResponse.json({ ok: false, error: "invoice_id is required" }, { status: 400 });
  }

  try {
    const rows = await prisma.invoice_items.findMany({
      where: { invoice_id: invoiceId },
      orderBy: { position: "asc" },
      select: {
        id: true,
        product_id: true,
        brand: true,
        description: true,
        hsn: true,
        quantity: true,
        unit_price: true,
        discount: true,
        position: true,
      },
    });
    return NextResponse.json({ ok: true, data: jsonSafe(rows) }, { headers: { "cache-control": "no-store" } });
  } catch (e: any) {
    console.error("vendor/invoice-items GET error", e);
    return NextResponse.json(
      { ok: false, error: e?.message || "Failed to load items" },
      { status: 500 },
    );
  }
}
