export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { getRouteVendor } from "@/lib/auth/getRouteVendor";
import { prisma } from "@/lib/db/prisma";
import { jsonSafe } from "@/lib/db/serialize";

// Vendor-scoped lookups for the invoice builder (new + edit invoice pages).
// Replaces the browser `supabase.from("inventory_units" | "products" |
// "invoice_units").select(...)` calls used while scanning units. EVERY
// inventory_units / products read is constrained to the caller's vendor_id so a
// vendor can only ever scan and resolve its OWN stock and catalog. The actual
// invoice create/update remains the existing `create_invoice_atomic` /
// `update_invoice_atomic` RPC writes (untouched).
//
// Nested `products`/`brands` are shaped to match the old PostgREST embeds
// (`products: { ..., brands: { name } }`) so callers can keep reading them.
const json = (d: any, s = 200) =>
  NextResponse.json(d, { status: s, headers: { "cache-control": "no-store" } });

const PRODUCT_SELECT = {
  id: true,
  name: true,
  hsn: true,
  compare_at_price: true,
  price: true,
  brands: { select: { name: true } },
} as const;

export async function GET(req: NextRequest) {
  const ctx = await getRouteVendor();
  if (!ctx) return json({ ok: false, error: "UNAUTHORIZED" }, 401);
  const vendorId = ctx.vendor.id;

  try {
    const sp = req.nextUrl.searchParams;
    const mode = sp.get("mode") || "";

    // ---- products by ids (resolve scanned units -> product details) ----
    if (mode === "products-by-ids") {
      const ids = Array.from(
        new Set((sp.get("ids") || "").split(",").map((s) => s.trim()).filter(Boolean)),
      );
      if (ids.length === 0) return json({ ok: true, data: [] });
      const rows = await prisma.products.findMany({
        where: { id: { in: ids }, vendor_id: vendorId },
        select: PRODUCT_SELECT,
      });
      return json({ ok: true, data: jsonSafe(rows) });
    }

    // ---- product name suggestions (manual line-item search) ----
    if (mode === "product-search") {
      const q = (sp.get("q") || "").trim();
      if (q.length < 2) return json({ ok: true, data: [] });
      const rows = await prisma.products.findMany({
        where: { vendor_id: vendorId, name: { contains: q } },
        select: PRODUCT_SELECT,
        take: 10,
      });
      return json({ ok: true, data: jsonSafe(rows) });
    }

    // ---- single unit by exact unit_code (legacy code scan) ----
    // status/sold_invoice_id are returned so the page keeps its existing
    // IN_STOCK / owned-by-this-invoice checks. `status` filtering is applied by
    // the caller; we only scope by vendor + unit_code here, optionally also
    // requiring a specific status when ?status= is given.
    if (mode === "unit-by-code") {
      const code = (sp.get("code") || "").trim();
      if (!code) return json({ ok: true, data: null });
      const status = sp.get("status");
      const soldInvoiceId = sp.get("sold_invoice_id");
      const where: any = { vendor_id: vendorId, unit_code: code };
      if (status) where.status = status;
      if (soldInvoiceId) where.sold_invoice_id = soldInvoiceId;
      const row = await prisma.inventory_units.findFirst({
        where,
        select: {
          id: true,
          unit_code: true,
          scan_code: true,
          status: true,
          product_id: true,
          sold_invoice_id: true,
        },
      });
      return json({ ok: true, data: jsonSafe(row) });
    }

    // ---- units by scan_code (shared-code scan: allocate N from the pool) ----
    if (mode === "units-by-scan") {
      const code = (sp.get("code") || "").trim();
      if (!code) return json({ ok: true, data: [] });
      const status = sp.get("status");
      const soldInvoiceId = sp.get("sold_invoice_id");
      const where: any = { vendor_id: vendorId, scan_code: code };
      if (status) where.status = status;
      if (soldInvoiceId) where.sold_invoice_id = soldInvoiceId;
      const rows = await prisma.inventory_units.findMany({
        where,
        select: {
          id: true,
          unit_code: true,
          scan_code: true,
          status: true,
          product_id: true,
          created_at: true,
          sold_invoice_id: true,
        },
        orderBy: { created_at: "asc" },
      });
      return json({ ok: true, data: jsonSafe(rows) });
    }

    // ---- invoice_units existence check for a set of unit_ids ----
    // Returns the links (unit_id + invoice_id) so the page can detect units
    // already attached to an invoice. Scoped to the caller's units via the
    // related inventory_unit's vendor_id.
    if (mode === "unit-links") {
      const ids = (sp.get("unitIds") || "").split(",").map((s) => s.trim()).filter(Boolean);
      if (ids.length === 0) return json({ ok: true, data: [] });
      const rows = await prisma.invoice_units.findMany({
        where: {
          unit_id: { in: ids },
          inventory_units: { vendor_id: vendorId },
        },
        select: { unit_id: true, invoice_id: true },
      });
      return json({ ok: true, data: rows });
    }

    return json({ ok: false, error: "UNKNOWN_MODE" }, 400);
  } catch (e: any) {
    console.error("vendor/invoice-builder GET error", e);
    return json({ ok: false, error: e?.message || "READ_FAILED" }, 500);
  }
}
