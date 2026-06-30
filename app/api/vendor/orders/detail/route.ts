export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { getRouteVendor } from "@/lib/auth/getRouteVendor";
import { prisma } from "@/lib/db/prisma";

/**
 * MySQL port of Postgres RPC `vendor_order_detail(p_order_id)`.
 * Vendor-scoped: returns the order only if it contains >= 1 item from this
 * vendor's products (else 404). items + vendor_subtotal cover this vendor's
 * lines only. Read-only.
 */
export async function GET(req: NextRequest) {
  const ctx = await getRouteVendor();
  if (!ctx) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const vendorId = ctx.vendor.id;
  const id = req.nextUrl.searchParams.get("id") ?? "";
  if (!id) {
    return NextResponse.json({ error: "id is required" }, { status: 400 });
  }

  const itemRows = await prisma.$queryRaw<
    {
      product_id: string | null;
      sku: string | null;
      name: string;
      quantity: number;
      unit_price: any;
      line_total: any;
      mrp: any;
      hero_image_path: string | null;
    }[]
  >`
    SELECT
      oi.product_id,
      oi.sku,
      oi.name,
      oi.quantity,
      oi.unit_price,
      COALESCE(oi.line_total, oi.unit_price * oi.quantity) AS line_total,
      oi.mrp,
      oi.hero_image_path
    FROM order_items oi
    JOIN products p ON p.id = oi.product_id
    WHERE oi.order_id = ${id}
      AND p.vendor_id = ${vendorId}
    ORDER BY oi.name
  `;

  // No items from this vendor -> order not visible to them.
  if (itemRows.length === 0) {
    return NextResponse.json({ error: "Order not found" }, { status: 404 });
  }

  const order = await prisma.orders.findUnique({
    where: { id },
    select: {
      id: true,
      order_number: true,
      status: true,
      created_at: true,
      currency: true,
      address_snapshot: true,
    },
  });
  if (!order) {
    return NextResponse.json({ error: "Order not found" }, { status: 404 });
  }

  const items = itemRows.map((r) => ({
    product_id: r.product_id,
    sku: r.sku,
    name: r.name,
    quantity: Number(r.quantity),
    unit_price: r.unit_price == null ? null : Number(r.unit_price),
    line_total: r.line_total == null ? 0 : Number(r.line_total),
    mrp: r.mrp == null ? null : Number(r.mrp),
    hero_image_path: r.hero_image_path,
  }));

  const vendor_subtotal = items.reduce((a, it) => a + (it.line_total || 0), 0);

  return NextResponse.json(
    {
      order_id: order.id,
      order_number: order.order_number,
      status: order.status,
      created_at: order.created_at ? new Date(order.created_at).toISOString() : null,
      currency: order.currency ?? "INR",
      address_snapshot: (order.address_snapshot as any) ?? null,
      vendor_subtotal,
      items,
    },
    { headers: { "cache-control": "no-store" } },
  );
}
