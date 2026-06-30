export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { getRouteVendor } from "@/lib/auth/getRouteVendor";
import { prisma } from "@/lib/db/prisma";

/**
 * Read-only MySQL port of Postgres RPC `vendor_demo_summary()` (no args).
 * Per-product demo unit counts + cost value. Org-wide.
 */
export async function GET() {
  const ctx = await getRouteVendor();
  if (!ctx) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const rows = await prisma.$queryRaw<
    {
      product_id: string;
      product_name: string;
      brand_name: string | null;
      demo_count: bigint;
      demo_value: any;
    }[]
  >`
    SELECT
      iu.product_id AS product_id,
      p.name AS product_name,
      b.name AS brand_name,
      COUNT(*) AS demo_count,
      COALESCE(SUM(COALESCE(p.purchase_price, 0)), 0) AS demo_value
    FROM inventory_units iu
    JOIN products p ON p.id = iu.product_id
    LEFT JOIN brands b ON b.id = COALESCE(iu.brand_id, p.brand_id)
    WHERE iu.status = 'DEMO'
    GROUP BY iu.product_id, p.name, b.name
    ORDER BY demo_count DESC
  `;

  const out = rows.map((r) => ({
    product_id: r.product_id,
    product_name: r.product_name,
    brand_name: r.brand_name ?? null,
    demo_count: Number(r.demo_count ?? 0),
    demo_value: Number(r.demo_value ?? 0),
  }));

  return NextResponse.json(out, {
    headers: { "cache-control": "no-store" },
  });
}
