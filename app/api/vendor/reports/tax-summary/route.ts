export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { getRouteVendor } from "@/lib/auth/getRouteVendor";
import { prisma } from "@/lib/db/prisma";

/**
 * GST / Tax summary over non-deleted invoices in a date range. Org-wide
 * (invoices have no vendor_id) — gated to any logged-in vendor, matching the
 * other report endpoints.
 *
 * Returns range-wide totals plus a per-tax_type breakdown so the reports hub
 * can export a clean GST sheet (the invoices list rows don't carry the
 * cgst/sgst/igst columns).
 */
export async function GET(req: NextRequest) {
  const ctx = await getRouteVendor();
  if (!ctx) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const from = req.nextUrl.searchParams.get("from") ?? "";
  const to = req.nextUrl.searchParams.get("to") ?? "";

  const [totalRows, byTypeRows] = await Promise.all([
    prisma.$queryRaw<
      {
        invoice_count: bigint;
        subtotal: any;
        cgst_amount: any;
        sgst_amount: any;
        igst_amount: any;
        tax_amount: any;
        grand_total: any;
      }[]
    >`
      SELECT
        COUNT(*) AS invoice_count,
        COALESCE(SUM(COALESCE(subtotal, 0)), 0) AS subtotal,
        COALESCE(SUM(COALESCE(cgst_amount, 0)), 0) AS cgst_amount,
        COALESCE(SUM(COALESCE(sgst_amount, 0)), 0) AS sgst_amount,
        COALESCE(SUM(COALESCE(igst_amount, 0)), 0) AS igst_amount,
        COALESCE(SUM(COALESCE(tax_amount, 0)), 0) AS tax_amount,
        COALESCE(SUM(COALESCE(grand_total, total_amount, 0)), 0) AS grand_total
      FROM invoices
      WHERE deleted_at IS NULL
        AND invoice_date BETWEEN ${from} AND ${to}
    `,
    prisma.$queryRaw<
      {
        tax_type: string | null;
        invoice_count: bigint;
        subtotal: any;
        cgst_amount: any;
        sgst_amount: any;
        igst_amount: any;
        tax_amount: any;
        grand_total: any;
      }[]
    >`
      SELECT
        COALESCE(NULLIF(TRIM(tax_type), ''), '(None)') AS tax_type,
        COUNT(*) AS invoice_count,
        COALESCE(SUM(COALESCE(subtotal, 0)), 0) AS subtotal,
        COALESCE(SUM(COALESCE(cgst_amount, 0)), 0) AS cgst_amount,
        COALESCE(SUM(COALESCE(sgst_amount, 0)), 0) AS sgst_amount,
        COALESCE(SUM(COALESCE(igst_amount, 0)), 0) AS igst_amount,
        COALESCE(SUM(COALESCE(tax_amount, 0)), 0) AS tax_amount,
        COALESCE(SUM(COALESCE(grand_total, total_amount, 0)), 0) AS grand_total
      FROM invoices
      WHERE deleted_at IS NULL
        AND invoice_date BETWEEN ${from} AND ${to}
      GROUP BY COALESCE(NULLIF(TRIM(tax_type), ''), '(None)')
      ORDER BY tax_amount DESC
    `,
  ]);

  const t = totalRows[0];
  const totals = {
    invoice_count: Number(t?.invoice_count ?? 0),
    subtotal: Number(t?.subtotal ?? 0),
    cgst_amount: Number(t?.cgst_amount ?? 0),
    sgst_amount: Number(t?.sgst_amount ?? 0),
    igst_amount: Number(t?.igst_amount ?? 0),
    tax_amount: Number(t?.tax_amount ?? 0),
    grand_total: Number(t?.grand_total ?? 0),
  };

  const by_tax_type = byTypeRows.map((r) => ({
    tax_type: r.tax_type ?? "(None)",
    invoice_count: Number(r.invoice_count ?? 0),
    subtotal: Number(r.subtotal ?? 0),
    cgst_amount: Number(r.cgst_amount ?? 0),
    sgst_amount: Number(r.sgst_amount ?? 0),
    igst_amount: Number(r.igst_amount ?? 0),
    tax_amount: Number(r.tax_amount ?? 0),
    grand_total: Number(r.grand_total ?? 0),
  }));

  return NextResponse.json(
    { totals, by_tax_type },
    { headers: { "cache-control": "no-store" } },
  );
}
