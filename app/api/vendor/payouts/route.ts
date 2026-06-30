export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { getRouteVendor } from "@/lib/auth/getRouteVendor";
import { prisma } from "@/lib/db/prisma";

/**
 * Computed vendor earnings ledger.
 *
 * There is no payout/disbursement table — earnings are derived from PAID
 * storefront orders that include this vendor's products. For each such order:
 *   gross      = SUM(order_items.line_total) for THIS vendor's products only
 *   commission = gross * vendors.commission_rate / 100   (platform commission)
 *   net        = gross - commission                       (vendor take-home)
 *
 * Returns lifetime totals, optional from/to-window totals, and a per-order
 * ledger (newest first). Disbursement scheduling is handled offline.
 */
export async function GET(req: NextRequest) {
  const ctx = await getRouteVendor();
  if (!ctx) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const vendorId = ctx.vendor.id;

  // commission_rate isn't part of the shared gate type; read it directly
  // (vendor-scoped) for this endpoint.
  const vendorRow = await prisma.vendors.findUnique({
    where: { id: vendorId },
    select: { commission_rate: true },
  });
  const commissionRate = Number(vendorRow?.commission_rate ?? 0) || 0;

  // Optional date window on orders.paid_at (YYYY-MM-DD). Inclusive of both ends.
  const fromRaw = (req.nextUrl.searchParams.get("from") || "").trim();
  const toRaw = (req.nextUrl.searchParams.get("to") || "").trim();
  const isYmd = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s);
  const from = isYmd(fromRaw) ? fromRaw : null;
  const to = isYmd(toRaw) ? toRaw : null;

  // One query: this vendor's lines on PAID orders, with per-order aggregation
  // done in SQL (cheap) and the rest aggregated in JS.
  const rows = await prisma.$queryRaw<
    {
      order_id: string;
      order_number: string | null;
      paid_at: Date | null;
      address_snapshot: any;
      gross: any;
    }[]
  >`
    SELECT
      o.id               AS order_id,
      o.order_number     AS order_number,
      o.paid_at          AS paid_at,
      o.address_snapshot AS address_snapshot,
      SUM(COALESCE(oi.line_total, oi.unit_price * oi.quantity)) AS gross
    FROM orders o
    JOIN order_items oi ON oi.order_id = o.id
    JOIN products p     ON p.id = oi.product_id
    WHERE p.vendor_id = ${vendorId}
      AND o.status = 'paid'
    GROUP BY o.id, o.order_number, o.paid_at, o.address_snapshot
    ORDER BY o.paid_at DESC, o.created_at DESC
  `;

  const round2 = (n: number) => Math.round(n * 100) / 100;
  const customerNameOf = (snap: any): string => {
    let s: any = snap;
    if (typeof s === "string") {
      try {
        s = JSON.parse(s);
      } catch {
        s = null;
      }
    }
    return s?.name || s?.full_name || s?.customer_name || "";
  };

  // paid_at as a YYYY-MM-DD for window filtering (DB stores naive datetime).
  const ymdOf = (d: Date | null): string | null =>
    d ? new Date(d).toISOString().slice(0, 10) : null;

  const ledger = rows.map((r) => {
    const gross = round2(Number(r.gross ?? 0));
    const commission = round2((gross * commissionRate) / 100);
    const net = round2(gross - commission);
    return {
      order_id: r.order_id,
      order_number: r.order_number,
      paid_at: r.paid_at ? new Date(r.paid_at).toISOString() : null,
      customer_name: customerNameOf(r.address_snapshot),
      gross,
      commission,
      net,
    };
  });

  const totalsOf = (items: typeof ledger) => {
    const total_gross = round2(items.reduce((a, x) => a + x.gross, 0));
    const total_commission = round2(items.reduce((a, x) => a + x.commission, 0));
    const total_net = round2(items.reduce((a, x) => a + x.net, 0));
    return {
      commission_rate: commissionRate,
      total_gross,
      total_commission,
      total_net,
      order_count: items.length,
    };
  };

  const summary = totalsOf(ledger);

  // Window summary (only when a valid date filter is supplied).
  let window: ReturnType<typeof totalsOf> | null = null;
  if (from || to) {
    const inWindow = ledger.filter((l) => {
      const d = ymdOf(l.paid_at ? new Date(l.paid_at) : null);
      if (!d) return false;
      if (from && d < from) return false;
      if (to && d > to) return false;
      return true;
    });
    window = { ...totalsOf(inWindow), from, to } as any;
  }

  return NextResponse.json(
    { summary, window, ledger },
    { headers: { "cache-control": "no-store" } },
  );
}
