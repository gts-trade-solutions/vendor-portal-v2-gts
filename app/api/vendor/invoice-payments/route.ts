export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { getRouteVendor } from "@/lib/auth/getRouteVendor";
import { prisma } from "@/lib/db/prisma";
import { jsonSafe } from "@/lib/db/serialize";

// Vendor-scoped read of invoice_payments for one invoice. Gated behind an
// authenticated vendor. Replaces browser `supabase.from("invoice_payments")`
// reads on the invoice detail page. Shape + ordering preserved.
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
    const rows = await prisma.invoice_payments.findMany({
      where: { invoice_id: invoiceId },
      orderBy: { paid_at: "asc" },
      select: {
        id: true,
        amount: true,
        method: true,
        reference: true,
        note: true,
        paid_at: true,
      },
    });
    return NextResponse.json({ ok: true, data: jsonSafe(rows) }, { headers: { "cache-control": "no-store" } });
  } catch (e: any) {
    console.error("vendor/invoice-payments GET error", e);
    return NextResponse.json(
      { ok: false, error: e?.message || "Failed to load payments" },
      { status: 500 },
    );
  }
}
