export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { getRouteVendor } from "@/lib/auth/getRouteVendor";
import { prisma } from "@/lib/db/prisma";

/**
 * MySQL port of Postgres RPC `online_orders_list(p_from, p_to)`.
 * Org-wide storefront order list for a date range, with per-order item counts
 * and how many real inventory units were allocated against the order.
 * Read-only. Any logged-in vendor (getRouteVendor non-null) may call it.
 */
export async function GET(req: NextRequest) {
  const ctx = await getRouteVendor();
  if (!ctx) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const from = req.nextUrl.searchParams.get("from") ?? "";
  const to = req.nextUrl.searchParams.get("to") ?? "";

  const rows = await prisma.$queryRaw<
    {
      id: string;
      order_number: string | null;
      status: string;
      paid_at: Date | null;
      total: any;
      total_inr: any;
      customer_name: string | null;
      customer_email: string | null;
      items_count: bigint;
      ordered_qty: any;
      allocated_qty: bigint;
    }[]
  >`
    SELECT
      o.id,
      o.order_number,
      o.status,
      o.paid_at,
      o.total,
      o.total_inr,
      o.address_snapshot->>'$.name'  AS customer_name,
      o.address_snapshot->>'$.email' AS customer_email,
      (SELECT COUNT(*) FROM order_items oi WHERE oi.order_id = o.id) AS items_count,
      (SELECT COALESCE(SUM(oi.quantity), 0) FROM order_items oi WHERE oi.order_id = o.id) AS ordered_qty,
      (SELECT COUNT(*) FROM inventory_units iu WHERE iu.sold_order_id = o.id) AS allocated_qty
    FROM orders o
    WHERE DATE(o.created_at) BETWEEN ${from} AND ${to}
    ORDER BY o.created_at DESC
  `;

  const data = rows.map((r) => ({
    id: r.id,
    order_number: r.order_number,
    status: r.status,
    paid_at: r.paid_at ? new Date(r.paid_at).toISOString() : null,
    total: r.total == null ? null : Number(r.total),
    total_inr: r.total_inr == null ? null : Number(r.total_inr),
    customer_name: r.customer_name,
    customer_email: r.customer_email,
    items_count: Number(r.items_count),
    ordered_qty: Number(r.ordered_qty),
    allocated_qty: Number(r.allocated_qty),
  }));

  return NextResponse.json(data, { headers: { "cache-control": "no-store" } });
}
