export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { getRouteVendor } from "@/lib/auth/getRouteVendor";
import { prisma } from "@/lib/db/prisma";

/**
 * Read-only MySQL port of Postgres RPC
 * `invoice_top_products(p_from, p_to, p_limit)`. Org-wide.
 * Top invoice line-items by sold value in the period.
 */
export async function GET(req: NextRequest) {
  const ctx = await getRouteVendor();
  if (!ctx) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const from = req.nextUrl.searchParams.get("from") ?? "";
  const to = req.nextUrl.searchParams.get("to") ?? "";
  const limitParamRaw = req.nextUrl.searchParams.get("limit");
  const parsed = Number(limitParamRaw);
  const limit =
    Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : 8;

  const rows = await prisma.$queryRaw<
    { description: string; qty: any; sold_value: any }[]
  >`
    SELECT
      ii.description AS description,
      COALESCE(SUM(ii.quantity), 0) AS qty,
      COALESCE(SUM(ii.line_total), 0) AS sold_value
    FROM invoice_items ii
    JOIN invoices i ON i.id = ii.invoice_id
    WHERE i.deleted_at IS NULL
      AND i.invoice_date BETWEEN ${from} AND ${to}
    GROUP BY ii.description
    ORDER BY sold_value DESC
    LIMIT ${limit}
  `;

  const out = rows.map((r) => ({
    description: r.description,
    qty: Number(r.qty ?? 0),
    sold_value: Number(r.sold_value ?? 0),
  }));

  return NextResponse.json(out, {
    headers: { "cache-control": "no-store" },
  });
}
