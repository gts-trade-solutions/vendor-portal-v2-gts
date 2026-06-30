export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { getRouteVendor } from "@/lib/auth/getRouteVendor";
import { prisma } from "@/lib/db/prisma";
import { Prisma } from "@prisma/client";

/**
 * Computed vendor notifications feed — no dedicated table. Surfaces actionable
 * alerts the vendor should act on, derived from inventory, products, invoices
 * and online orders. A handful of aggregate queries (kept efficient).
 *
 * Scoping:
 *   - inventory / products -> ctx.vendor.id (vendor-scoped)
 *   - invoices             -> org-wide (invoices have no vendor_id, like the
 *                             other report endpoints)
 *   - online orders        -> orders containing this vendor's products
 *
 * Response: { items: NotificationItem[], total }
 *   total = number of non-zero alert groups.
 */

type Severity = "critical" | "warning" | "info";
type NotificationItem = {
  key: string;
  type: string;
  severity: Severity;
  title: string;
  detail: string;
  count: number;
  href: string;
};

const inr0 = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  maximumFractionDigits: 0,
});
const money = (v: unknown) => inr0.format(Number(v) || 0);

// Active statuses that count for expiry alerting (mirrors the dashboard).
const EXPIRY_STATUSES = ["IN_STOCK", "INVOICED", "DEMO"];

function todayYmd(): string {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.toISOString().slice(0, 10);
}

export async function GET() {
  const ctx = await getRouteVendor();
  if (!ctx) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const vendorId = ctx.vendor.id;
  const today = todayYmd();

  // Vendor's expiry-alert window (days). Default 180, same as the dashboard.
  const vendorRow = await prisma.vendors.findUnique({
    where: { id: vendorId },
    select: { expiry_alert_days: true },
  });
  const alertDaysRaw = Number(vendorRow?.expiry_alert_days ?? 180);
  const alertDays = Number.isFinite(alertDaysRaw) && alertDaysRaw > 0 ? alertDaysRaw : 180;
  const soonEnd = new Date(Date.now() + alertDays * 86400000)
    .toISOString()
    .slice(0, 10);

  const statusList = Prisma.join(EXPIRY_STATUSES);

  // Run the independent aggregate queries in parallel.
  const [
    expiredRows,
    expiringRows,
    stockRows,
    overdueRows,
    unfulfilledRows,
  ] = await Promise.all([
    // 1. Expired units (vendor's): expiry_date < today, active statuses.
    prisma.$queryRaw<{ cnt: bigint }[]>(Prisma.sql`
      SELECT COUNT(*) AS cnt
      FROM inventory_units
      WHERE vendor_id = ${vendorId}
        AND status IN (${statusList})
        AND expiry_date < ${today}
    `),
    // 2. Expiring soon (vendor's): today <= expiry_date <= today + alertDays.
    prisma.$queryRaw<{ cnt: bigint }[]>(Prisma.sql`
      SELECT COUNT(*) AS cnt
      FROM inventory_units
      WHERE vendor_id = ${vendorId}
        AND status IN (${statusList})
        AND expiry_date >= ${today}
        AND expiry_date <= ${soonEnd}
    `),
    // 3. Per-product IN_STOCK unit counts, joined to this vendor's products so
    //    products with zero IN_STOCK units still appear (LEFT JOIN). Drives both
    //    out-of-stock (0) and low-stock (1..5) groups.
    prisma.$queryRaw<{ out_of_stock: bigint; low_stock: bigint }[]>(Prisma.sql`
      SELECT
        COUNT(CASE WHEN in_stock = 0 THEN 1 END) AS out_of_stock,
        COUNT(CASE WHEN in_stock BETWEEN 1 AND 5 THEN 1 END) AS low_stock
      FROM (
        SELECT
          p.id,
          COUNT(iu.id) AS in_stock
        FROM products p
        LEFT JOIN inventory_units iu
          ON iu.product_id = p.id
         AND iu.vendor_id = ${vendorId}
         AND iu.status = 'IN_STOCK'
        WHERE p.vendor_id = ${vendorId}
        GROUP BY p.id
      ) AS per_product
    `),
    // 4. Overdue invoices (org-wide): due_date set + past + not paid.
    prisma.$queryRaw<{ cnt: bigint; outstanding: any }[]>(Prisma.sql`
      SELECT
        COUNT(*) AS cnt,
        COALESCE(SUM(GREATEST(COALESCE(grand_total, total_amount, 0) - COALESCE(amount_paid, 0), 0)), 0) AS outstanding
      FROM invoices
      WHERE deleted_at IS NULL
        AND due_date IS NOT NULL
        AND due_date < ${today}
        AND (payment_status IS NULL OR payment_status <> 'PAID')
    `),
    // 5. Unfulfilled paid online orders containing this vendor's products.
    //    A vendor-order is "unfulfilled" when it has NO fulfillment row for this
    //    vendor, OR the row's status is 'PENDING'. (Best-effort: treats any
    //    non-DELIVERED/missing row as actionable via the PENDING / NULL check.)
    prisma.$queryRaw<{ cnt: bigint }[]>(Prisma.sql`
      SELECT COUNT(*) AS cnt
      FROM (
        SELECT DISTINCT o.id
        FROM orders o
        JOIN order_items oi ON oi.order_id = o.id
        JOIN products p ON p.id = oi.product_id
        LEFT JOIN vendor_order_fulfillment vof
          ON vof.order_id = o.id
         AND vof.vendor_id = ${vendorId}
        WHERE p.vendor_id = ${vendorId}
          AND o.status = 'paid'
          AND (vof.id IS NULL OR vof.status = 'PENDING')
      ) AS unfulfilled
    `),
  ]);

  const expiredCount = Number(expiredRows?.[0]?.cnt ?? 0);
  const expiringCount = Number(expiringRows?.[0]?.cnt ?? 0);
  const outOfStockCount = Number(stockRows?.[0]?.out_of_stock ?? 0);
  const lowStockCount = Number(stockRows?.[0]?.low_stock ?? 0);
  const overdueCount = Number(overdueRows?.[0]?.cnt ?? 0);
  const overdueOutstanding = Number(overdueRows?.[0]?.outstanding ?? 0);
  const unfulfilledCount = Number(unfulfilledRows?.[0]?.cnt ?? 0);

  const items: NotificationItem[] = [];

  if (expiredCount > 0) {
    items.push({
      key: "expired",
      type: "inventory",
      severity: "critical",
      title: "Expired units in stock",
      detail: `${expiredCount} unit${expiredCount === 1 ? "" : "s"} past expiry — pull from sale`,
      count: expiredCount,
      href: "/vendor/alerts?tab=expired",
    });
  }

  if (expiringCount > 0) {
    items.push({
      key: "expiring",
      type: "inventory",
      severity: "warning",
      title: "Units expiring soon",
      detail: `${expiringCount} unit${expiringCount === 1 ? "" : "s"} expire within ${alertDays} days`,
      count: expiringCount,
      href: "/vendor/alerts?tab=expiring",
    });
  }

  if (outOfStockCount > 0) {
    items.push({
      key: "out_of_stock",
      type: "stock",
      severity: "warning",
      title: "Out-of-stock products",
      detail: `${outOfStockCount} product${outOfStockCount === 1 ? "" : "s"} have no units in stock`,
      count: outOfStockCount,
      href: "/vendor/alerts?tab=zero",
    });
  }

  if (lowStockCount > 0) {
    items.push({
      key: "low_stock",
      type: "stock",
      severity: "info",
      title: "Low-stock products",
      detail: `${lowStockCount} product${lowStockCount === 1 ? "" : "s"} down to 5 or fewer units`,
      count: lowStockCount,
      href: "/vendor/alerts?tab=low",
    });
  }

  if (overdueCount > 0) {
    items.push({
      key: "overdue_invoices",
      type: "invoices",
      severity: "critical",
      title: "Overdue invoices",
      detail: `${overdueCount} invoice${overdueCount === 1 ? "" : "s"} past due · ${money(overdueOutstanding)} outstanding`,
      count: overdueCount,
      href: "/vendor/invoices?pay=UNPAID",
    });
  }

  if (unfulfilledCount > 0) {
    items.push({
      key: "unfulfilled_orders",
      type: "orders",
      severity: "warning",
      title: "Unfulfilled paid orders",
      detail: `${unfulfilledCount} paid online order${unfulfilledCount === 1 ? "" : "s"} awaiting fulfillment`,
      count: unfulfilledCount,
      href: "/vendor/orders",
    });
  }

  // total = number of non-zero alert groups (matches the badge semantics).
  const total = items.length;

  return NextResponse.json(
    { items, total },
    { headers: { "cache-control": "no-store" } },
  );
}
