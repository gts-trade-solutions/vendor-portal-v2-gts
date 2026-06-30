export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { getRouteVendor } from "@/lib/auth/getRouteVendor";
import { prisma } from "@/lib/db/prisma";

/**
 * Read-only MySQL port of Postgres RPC
 * `invoice_outstanding_by_customer(p_from, p_to)`. Org-wide.
 * Returns an array of per-customer billed/paid/outstanding rows.
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
      customer_name: string;
      phone: string | null;
      invoice_count: bigint;
      billed: any;
      paid: any;
      outstanding: any;
    }[]
  >`
    SELECT
      COALESCE(NULLIF(TRIM(customer_name), ''), '(Unnamed)') AS customer_name,
      MAX(phone) AS phone,
      COUNT(*) AS invoice_count,
      COALESCE(SUM(COALESCE(grand_total, total_amount, 0)), 0) AS billed,
      COALESCE(SUM(COALESCE(amount_paid, 0)), 0) AS paid,
      COALESCE(SUM(GREATEST(COALESCE(grand_total, total_amount, 0) - COALESCE(amount_paid, 0), 0)), 0) AS outstanding
    FROM invoices
    WHERE deleted_at IS NULL
      AND invoice_date BETWEEN ${from} AND ${to}
    GROUP BY COALESCE(NULLIF(TRIM(customer_name), ''), '(Unnamed)')
    ORDER BY outstanding DESC
  `;

  const out = rows.map((r) => ({
    customer_name: r.customer_name,
    phone: r.phone ?? null,
    invoice_count: Number(r.invoice_count ?? 0),
    billed: Number(r.billed ?? 0),
    paid: Number(r.paid ?? 0),
    outstanding: Number(r.outstanding ?? 0),
  }));

  return NextResponse.json(out, {
    headers: { "cache-control": "no-store" },
  });
}
