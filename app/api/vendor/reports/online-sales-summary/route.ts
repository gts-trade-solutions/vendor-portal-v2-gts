export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { getRouteVendor } from "@/lib/auth/getRouteVendor";
import { prisma } from "@/lib/db/prisma";

/**
 * Read-only MySQL port of Postgres RPC `online_sales_summary(p_from, p_to)`.
 * Storefront order counts + paid revenue. Org-wide.
 */
export async function GET(req: NextRequest) {
  const ctx = await getRouteVendor();
  if (!ctx) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const from = req.nextUrl.searchParams.get("from") ?? "";
  const to = req.nextUrl.searchParams.get("to") ?? "";

  const rows = await prisma.$queryRaw<
    { order_count: bigint; paid_count: bigint; revenue: any }[]
  >`
    SELECT
      COUNT(*) AS order_count,
      COUNT(CASE WHEN status = 'paid' THEN 1 END) AS paid_count,
      COALESCE(SUM(CASE WHEN status = 'paid' THEN COALESCE(total_inr, total, 0) ELSE 0 END), 0) AS revenue
    FROM orders
    WHERE DATE(created_at) BETWEEN ${from} AND ${to}
  `;

  const r = rows[0];
  return NextResponse.json(
    {
      order_count: Number(r?.order_count ?? 0),
      paid_count: Number(r?.paid_count ?? 0),
      revenue: Number(r?.revenue ?? 0),
    },
    { headers: { "cache-control": "no-store" } },
  );
}
