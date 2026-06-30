export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { getRouteVendor } from "@/lib/auth/getRouteVendor";
import { prisma } from "@/lib/db/prisma";

/**
 * Read-only MySQL port of Postgres RPC `invoice_dashboard_summary(p_from, p_to)`.
 * Org-wide (invoices have no vendor_id) — gated to any logged-in vendor.
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
      invoice_count: bigint;
      company_count: bigint;
      total_billed: any;
      total_paid: any;
      total_outstanding: any;
      paid_count: bigint;
      partial_count: bigint;
      unpaid_count: bigint;
    }[]
  >`
    SELECT
      COUNT(*) AS invoice_count,
      COUNT(DISTINCT company_id) AS company_count,
      COALESCE(SUM(COALESCE(grand_total, total_amount, 0)), 0) AS total_billed,
      COALESCE(SUM(COALESCE(amount_paid, 0)), 0) AS total_paid,
      COALESCE(SUM(GREATEST(COALESCE(grand_total, total_amount, 0) - COALESCE(amount_paid, 0), 0)), 0) AS total_outstanding,
      COUNT(CASE WHEN payment_status = 'PAID' THEN 1 END) AS paid_count,
      COUNT(CASE WHEN payment_status = 'PARTIAL' THEN 1 END) AS partial_count,
      COUNT(CASE WHEN payment_status = 'UNPAID' OR payment_status IS NULL THEN 1 END) AS unpaid_count
    FROM invoices
    WHERE deleted_at IS NULL
      AND invoice_date BETWEEN ${from} AND ${to}
  `;

  const r = rows[0];
  return NextResponse.json(
    {
      invoice_count: Number(r?.invoice_count ?? 0),
      company_count: Number(r?.company_count ?? 0),
      total_billed: Number(r?.total_billed ?? 0),
      total_paid: Number(r?.total_paid ?? 0),
      total_outstanding: Number(r?.total_outstanding ?? 0),
      paid_count: Number(r?.paid_count ?? 0),
      partial_count: Number(r?.partial_count ?? 0),
      unpaid_count: Number(r?.unpaid_count ?? 0),
    },
    { headers: { "cache-control": "no-store" } },
  );
}
