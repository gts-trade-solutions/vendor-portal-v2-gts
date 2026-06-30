export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { getRouteVendor } from "@/lib/auth/getRouteVendor";
import { prisma } from "@/lib/db/prisma";
import { jsonSafe } from "@/lib/db/serialize";

// Vendor-scoped read of invoice_units for one invoice. Gated behind an
// authenticated vendor. Replaces browser `supabase.from("invoice_units")` reads
// on the invoices list (count), invoice detail, and edit pages.
//
//   ?invoice_id=<uuid>   (required)
//   ?count=1             -> { ok, count } only (list page revert-count lookup)
//   ?withProduct=1       -> include nested products(+brands) (edit page scan-mode)
export async function GET(req: NextRequest) {
  const auth = await getRouteVendor();
  if (!auth) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });

  const sp = req.nextUrl.searchParams;

  try {
    // Units page fallback: given a set of inventory unit ids, return a map of
    // unitId -> { name, phone, invoice_number } from the unit's invoice. This
    // replaces the page's two-step `invoice_units` -> `invoices` browser reads.
    // Vendor-scoped via the related inventory_unit's vendor_id so a vendor can
    // only resolve invoices for its own units.
    if (sp.get("mode") === "customer-fallback") {
      const idsCsv = sp.get("unitIds") || "";
      const unitIds = idsCsv.split(",").map((s) => s.trim()).filter(Boolean);
      if (unitIds.length === 0) return NextResponse.json({ ok: true, data: {} }, { headers: { "cache-control": "no-store" } });

      const links = await prisma.invoice_units.findMany({
        where: {
          unit_id: { in: unitIds },
          inventory_units: { vendor_id: auth.vendor.id },
        },
        select: {
          unit_id: true,
          invoices: {
            select: { customer_name: true, phone: true, invoice_number: true },
          },
        },
      });

      const out: Record<string, { name: string | null; phone: string | null; invoice_number: string | null }> = {};
      for (const l of links) {
        if (!l.unit_id || !l.invoices) continue;
        if (out[l.unit_id]) continue; // first invoice wins (mirrors old logic)
        out[l.unit_id] = {
          name: l.invoices.customer_name ?? null,
          phone: l.invoices.phone ?? null,
          invoice_number: l.invoices.invoice_number ?? null,
        };
      }
      return NextResponse.json({ ok: true, data: out }, { headers: { "cache-control": "no-store" } });
    }

    const invoiceId = sp.get("invoice_id");
    if (!invoiceId) {
      return NextResponse.json({ ok: false, error: "invoice_id is required" }, { status: 400 });
    }

    if (sp.get("count")) {
      const count = await prisma.invoice_units.count({ where: { invoice_id: invoiceId } });
      return NextResponse.json({ ok: true, count }, { headers: { "cache-control": "no-store" } });
    }

    if (sp.get("withProduct")) {
      // Edit page: shapes the nested join as `products: { ..., brands: { name } }`
      // (same key the Supabase select produced via `products:products(...)`).
      const rows = await prisma.invoice_units.findMany({
        where: { invoice_id: invoiceId },
        select: {
          unit_id: true,
          unit_code: true,
          scan_code: true,
          product_id: true,
          products: {
            select: {
              id: true,
              name: true,
              hsn: true,
              compare_at_price: true,
              price: true,
              brands: { select: { name: true } },
            },
          },
        },
      });
      return NextResponse.json({ ok: true, data: jsonSafe(rows) }, { headers: { "cache-control": "no-store" } });
    }

    // Detail page: flat unit rows, ordered by id asc.
    const rows = await prisma.invoice_units.findMany({
      where: { invoice_id: invoiceId },
      orderBy: { id: "asc" },
      select: {
        id: true,
        unit_id: true,
        unit_code: true,
        scan_code: true,
        product_id: true,
      },
    });
    return NextResponse.json({ ok: true, data: rows }, { headers: { "cache-control": "no-store" } });
  } catch (e: any) {
    console.error("vendor/invoice-units GET error", e);
    return NextResponse.json(
      { ok: false, error: e?.message || "Failed to load invoice units" },
      { status: 500 },
    );
  }
}
