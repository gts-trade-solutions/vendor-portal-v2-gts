export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { getRouteVendor } from "@/lib/auth/getRouteVendor";
import { prisma } from "@/lib/db/prisma";

/**
 * Read-only MySQL port of Postgres RPC `invoice_sales_by_month(p_from, p_to)`.
 * Billed vs collected grouped by month. Org-wide.
 */
export async function GET(req: NextRequest) {
  const ctx = await getRouteVendor();
  if (!ctx) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const from = req.nextUrl.searchParams.get("from") ?? "";
  const to = req.nextUrl.searchParams.get("to") ?? "";

  const rows = await prisma.$queryRaw<
    { month: string; billed: any; paid: any }[]
  >`
    SELECT
      DATE_FORMAT(invoice_date, '%Y-%m-01') AS month,
      COALESCE(SUM(COALESCE(grand_total, total_amount, 0)), 0) AS billed,
      COALESCE(SUM(COALESCE(amount_paid, 0)), 0) AS paid
    FROM invoices
    WHERE deleted_at IS NULL
      AND invoice_date BETWEEN ${from} AND ${to}
    GROUP BY DATE_FORMAT(invoice_date, '%Y-%m-01')
    ORDER BY month
  `;

  const out = rows.map((r) => ({
    month: r.month,
    billed: Number(r.billed ?? 0),
    paid: Number(r.paid ?? 0),
  }));

  return NextResponse.json(out, {
    headers: { "cache-control": "no-store" },
  });
}
