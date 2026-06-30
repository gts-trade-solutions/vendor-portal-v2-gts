export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { getRouteVendor } from "@/lib/auth/getRouteVendor";
import { prisma } from "@/lib/db/prisma";

/**
 * Read-only MySQL port of Postgres RPC `vendor_profit_summary(p_from, p_to)`.
 * Invoice + online revenue, COGS from sold units, gross profit. Org-wide.
 */
export async function GET(req: NextRequest) {
  const ctx = await getRouteVendor();
  if (!ctx) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const from = req.nextUrl.searchParams.get("from") ?? "";
  const to = req.nextUrl.searchParams.get("to") ?? "";

  const [invRows, onlineRows, costRows] = await Promise.all([
    prisma.$queryRaw<{ inv_rev: any }[]>`
      SELECT COALESCE(SUM(ii.line_total), 0) AS inv_rev
      FROM invoice_items ii
      JOIN invoices i ON i.id = ii.invoice_id
      WHERE i.deleted_at IS NULL
        AND i.invoice_date BETWEEN ${from} AND ${to}
    `,
    prisma.$queryRaw<{ online_rev: any }[]>`
      SELECT COALESCE(SUM(oi.line_total), 0) AS online_rev
      FROM order_items oi
      JOIN orders o ON o.id = oi.order_id
      WHERE o.status = 'paid'
        AND DATE(o.paid_at) BETWEEN ${from} AND ${to}
    `,
    prisma.$queryRaw<{ cogs: any; units_sold: bigint }[]>`
      SELECT
        COALESCE(SUM(COALESCE(p.purchase_price, 0)), 0) AS cogs,
        COUNT(*) AS units_sold
      FROM inventory_units iu
      JOIN products p ON p.id = iu.product_id
      WHERE iu.status = 'SOLD'
        AND DATE(iu.sold_at) BETWEEN ${from} AND ${to}
    `,
  ]);

  const invoice_revenue = Number(invRows[0]?.inv_rev ?? 0);
  const online_revenue = Number(onlineRows[0]?.online_rev ?? 0);
  const revenue = invoice_revenue + online_revenue;
  const cogs = Number(costRows[0]?.cogs ?? 0);
  const units_sold = Number(costRows[0]?.units_sold ?? 0);

  return NextResponse.json(
    {
      invoice_revenue,
      online_revenue,
      revenue,
      cogs,
      units_sold,
      gross_profit: revenue - cogs,
    },
    { headers: { "cache-control": "no-store" } },
  );
}
