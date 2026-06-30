export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { getRouteVendor } from "@/lib/auth/getRouteVendor";
import { prisma } from "@/lib/db/prisma";

/**
 * Read-only MySQL port of Postgres RPC `vendor_brand_stock_summary()` (no args).
 * Per-brand unit counts + stock/demo/sold valuation. Org-wide.
 *
 * The page consumes `in_stock_value` (cost of IN_STOCK units), so the
 * `stock_value` aggregate is surfaced under that name.
 */
export async function GET() {
  const ctx = await getRouteVendor();
  if (!ctx) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const rows = await prisma.$queryRaw<
    {
      brand_id: string;
      brand_name: string;
      product_count: bigint;
      total_units: bigint;
      in_stock: bigint;
      sold: bigint;
      demo: bigint;
      expired: bigint;
      in_stock_value: any;
      demo_value: any;
      sold_value: any;
    }[]
  >`
    WITH u AS (
      SELECT
        iu.id AS unit_id,
        iu.product_id AS product_id,
        iu.status AS status,
        iu.expiry_date AS expiry_date,
        COALESCE(p.purchase_price, 0) AS cost,
        COALESCE(iu.brand_id, p.brand_id) AS b_id
      FROM inventory_units iu
      JOIN products p ON p.id = iu.product_id
    ),
    unit_agg AS (
      SELECT
        b_id,
        COUNT(DISTINCT product_id) AS product_count,
        COUNT(*) AS total_units,
        COUNT(CASE WHEN status = 'IN_STOCK' THEN 1 END) AS in_stock,
        COUNT(CASE WHEN status = 'SOLD' THEN 1 END) AS sold,
        COUNT(CASE WHEN status = 'DEMO' THEN 1 END) AS demo,
        COUNT(CASE WHEN expiry_date < CURDATE() AND status IN ('IN_STOCK', 'DEMO') THEN 1 END) AS expired,
        COALESCE(SUM(CASE WHEN status = 'IN_STOCK' THEN cost ELSE 0 END), 0) AS stock_value,
        COALESCE(SUM(CASE WHEN status = 'DEMO' THEN cost ELSE 0 END), 0) AS demo_value
      FROM u
      GROUP BY b_id
    ),
    inv_agg AS (
      SELECT
        p.brand_id AS b_id,
        COALESCE(SUM(ii.line_total), 0) AS sold_value
      FROM invoice_items ii
      JOIN invoices i ON i.id = ii.invoice_id AND i.deleted_at IS NULL
      JOIN products p ON p.id = ii.product_id
      GROUP BY p.brand_id
    )
    SELECT
      b.id AS brand_id,
      b.name AS brand_name,
      COALESCE(unit_agg.product_count, 0) AS product_count,
      COALESCE(unit_agg.total_units, 0) AS total_units,
      COALESCE(unit_agg.in_stock, 0) AS in_stock,
      COALESCE(unit_agg.sold, 0) AS sold,
      COALESCE(unit_agg.demo, 0) AS demo,
      COALESCE(unit_agg.expired, 0) AS expired,
      COALESCE(unit_agg.stock_value, 0) AS in_stock_value,
      COALESCE(unit_agg.demo_value, 0) AS demo_value,
      COALESCE(inv_agg.sold_value, 0) AS sold_value
    FROM brands b
    LEFT JOIN unit_agg ON unit_agg.b_id = b.id
    LEFT JOIN inv_agg ON inv_agg.b_id = b.id
    WHERE unit_agg.b_id IS NOT NULL OR inv_agg.b_id IS NOT NULL
    ORDER BY b.name
  `;

  const out = rows.map((r) => ({
    brand_id: r.brand_id,
    brand_name: r.brand_name,
    product_count: Number(r.product_count ?? 0),
    total_units: Number(r.total_units ?? 0),
    in_stock: Number(r.in_stock ?? 0),
    sold: Number(r.sold ?? 0),
    demo: Number(r.demo ?? 0),
    expired: Number(r.expired ?? 0),
    in_stock_value: Number(r.in_stock_value ?? 0),
    demo_value: Number(r.demo_value ?? 0),
    sold_value: Number(r.sold_value ?? 0),
  }));

  return NextResponse.json(out, {
    headers: { "cache-control": "no-store" },
  });
}
