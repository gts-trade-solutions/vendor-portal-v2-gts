export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { getRouteVendor } from "@/lib/auth/getRouteVendor";
import { prisma } from "@/lib/db/prisma";

/**
 * MySQL port of Postgres RPC `online_order_detail(p_order_id)`.
 * Org-wide line-item breakdown for one storefront order, including whether each
 * item's product is linked to an inventory product and how many real units were
 * allocated for it. Read-only. Any logged-in vendor may call it.
 */
export async function GET(req: NextRequest) {
  const ctx = await getRouteVendor();
  if (!ctx) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const id = req.nextUrl.searchParams.get("id") ?? "";
  if (!id) {
    return NextResponse.json({ error: "id is required" }, { status: 400 });
  }

  const rows = await prisma.$queryRaw<
    {
      product_id: string | null;
      name: string;
      quantity: number;
      unit_price: any;
      allocated: bigint;
    }[]
  >`
    SELECT
      oi.product_id,
      oi.name,
      oi.quantity,
      oi.unit_price,
      (
        SELECT COUNT(*)
        FROM inventory_units iu
        WHERE iu.sold_order_id = ${id}
          AND iu.product_id = oi.product_id
      ) AS allocated
    FROM order_items oi
    LEFT JOIN products p ON p.id = oi.product_id
    WHERE oi.order_id = ${id}
    ORDER BY oi.created_at
  `;

  const data = rows.map((r) => ({
    product_id: r.product_id,
    name: r.name,
    quantity: Number(r.quantity),
    unit_price: r.unit_price == null ? null : Number(r.unit_price),
    // A product is now its own inventory source; expose its own id here so the
    // online-orders page (which treats a non-null value as "linked") still works.
    inventory_product_id: r.product_id,
    allocated: Number(r.allocated),
  }));

  return NextResponse.json(data, { headers: { "cache-control": "no-store" } });
}
