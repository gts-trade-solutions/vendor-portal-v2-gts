export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { getRouteVendor } from "@/lib/auth/getRouteVendor";
import { prisma } from "@/lib/db/prisma";

/**
 * Read-only MySQL port of Postgres RPC `invoice_aging_buckets(p_from, p_to)`.
 * AR aging by days-past-due over outstanding invoices. Org-wide.
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
      current: any;
      d31_60: any;
      d61_90: any;
      d90_plus: any;
    }[]
  >`
    SELECT
      COALESCE(SUM(CASE WHEN age <= 30 THEN outstanding ELSE 0 END), 0) AS current,
      COALESCE(SUM(CASE WHEN age BETWEEN 31 AND 60 THEN outstanding ELSE 0 END), 0) AS d31_60,
      COALESCE(SUM(CASE WHEN age BETWEEN 61 AND 90 THEN outstanding ELSE 0 END), 0) AS d61_90,
      COALESCE(SUM(CASE WHEN age > 90 THEN outstanding ELSE 0 END), 0) AS d90_plus
    FROM (
      SELECT
        GREATEST(COALESCE(grand_total, total_amount, 0) - COALESCE(amount_paid, 0), 0) AS outstanding,
        DATEDIFF(CURDATE(), COALESCE(due_date, invoice_date)) AS age
      FROM invoices
      WHERE deleted_at IS NULL
        AND invoice_date BETWEEN ${from} AND ${to}
        AND GREATEST(COALESCE(grand_total, total_amount, 0) - COALESCE(amount_paid, 0), 0) > 0
    ) AS t
  `;

  const r = rows[0];
  return NextResponse.json(
    {
      current: Number(r?.current ?? 0),
      d31_60: Number(r?.d31_60 ?? 0),
      d61_90: Number(r?.d61_90 ?? 0),
      d90_plus: Number(r?.d90_plus ?? 0),
    },
    { headers: { "cache-control": "no-store" } },
  );
}
