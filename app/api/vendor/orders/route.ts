export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { getRouteVendor } from "@/lib/auth/getRouteVendor";
import { prisma } from "@/lib/db/prisma";
import { Prisma } from "@prisma/client";

/**
 * MySQL port of Postgres RPC `vendor_orders_list(p_limit, p_offset)`.
 * Vendor-scoped: only orders that include at least one of this vendor's
 * products. vendor_total / item_qty are summed over this vendor's lines only.
 * Read-only.
 *
 * Query params:
 *   q       — search order_number OR customer name (address_snapshot->>'$.name')
 *   status  — exact match on orders.status (when provided)
 *   from    — orders.created_at >= from (YYYY-MM-DD, inclusive)
 *   to      — orders.created_at <= to (YYYY-MM-DD, inclusive end-of-day)
 *   sort    — created_at | vendor_total | status (default created_at)
 *   dir     — asc | desc (default desc)
 *   limit   — page size (default 50)
 *   offset  — page offset (default 0)
 *   all     — "1" to ignore limit/offset and return everything matching (export)
 *
 * Response: { data: VendorOrderRow[], count: number }
 */
export async function GET(req: NextRequest) {
  const ctx = await getRouteVendor();
  if (!ctx) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const vendorId = ctx.vendor.id;
  const sp = req.nextUrl.searchParams;

  const limitRaw = Number(sp.get("limit") ?? 50);
  const offsetRaw = Number(sp.get("offset") ?? 0);
  const limit = Number.isFinite(limitRaw) ? Math.max(0, Math.trunc(limitRaw)) : 50;
  const offset = Number.isFinite(offsetRaw) ? Math.max(0, Math.trunc(offsetRaw)) : 0;
  const all = sp.get("all") === "1";

  const q = (sp.get("q") ?? "").trim();
  const status = (sp.get("status") ?? "").trim();
  const from = (sp.get("from") ?? "").trim();
  const to = (sp.get("to") ?? "").trim();

  const sortParam = (sp.get("sort") ?? "created_at").trim();
  const sortMap: Record<string, Prisma.Sql> = {
    created_at: Prisma.raw("o.created_at"),
    vendor_total: Prisma.raw("vlines.vendor_total"),
    status: Prisma.raw("o.status"),
  };
  const sortCol = sortMap[sortParam] ?? sortMap.created_at;
  const dir = (sp.get("dir") ?? "desc").toLowerCase() === "asc"
    ? Prisma.raw("ASC")
    : Prisma.raw("DESC");

  // Build WHERE conditions. Vendor scoping is enforced inside the vlines join
  // (the JOIN itself restricts to orders that have this vendor's lines).
  const conds: Prisma.Sql[] = [];

  if (q) {
    const like = `%${q}%`;
    conds.push(
      Prisma.sql`(o.order_number LIKE ${like} OR JSON_UNQUOTE(JSON_EXTRACT(o.address_snapshot, '$.name')) LIKE ${like})`
    );
  }
  if (status) {
    conds.push(Prisma.sql`o.status = ${status}`);
  }
  if (from) {
    // inclusive from start-of-day
    conds.push(Prisma.sql`o.created_at >= ${`${from} 00:00:00`}`);
  }
  if (to) {
    // inclusive to end-of-day
    conds.push(Prisma.sql`o.created_at <= ${`${to} 23:59:59`}`);
  }

  const whereSql = conds.length
    ? Prisma.sql`WHERE ${Prisma.join(conds, " AND ")}`
    : Prisma.empty;

  // vendor-scoped per-order aggregate, shared by count + data queries
  const vlinesSql = Prisma.sql`
    JOIN (
      SELECT
        oi.order_id,
        SUM(COALESCE(oi.line_total, oi.unit_price * oi.quantity)) AS vendor_total,
        SUM(oi.quantity) AS item_qty
      FROM order_items oi
      JOIN products p ON p.id = oi.product_id
      WHERE p.vendor_id = ${vendorId}
      GROUP BY oi.order_id
    ) AS vlines ON vlines.order_id = o.id
  `;

  // total matching count (for pagination)
  const countRows = await prisma.$queryRaw<{ cnt: bigint }[]>(Prisma.sql`
    SELECT COUNT(*) AS cnt
    FROM orders o
    ${vlinesSql}
    ${whereSql}
  `);
  const count = Number(countRows?.[0]?.cnt ?? 0);

  const limitSql = all
    ? Prisma.empty
    : Prisma.sql`LIMIT ${limit} OFFSET ${offset}`;

  const rows = await prisma.$queryRaw<
    {
      order_id: string;
      order_number: string | null;
      status: string;
      created_at: Date;
      currency: string | null;
      vendor_total: any;
      item_qty: any;
      address_snapshot: any;
    }[]
  >(Prisma.sql`
    SELECT
      o.id           AS order_id,
      o.order_number AS order_number,
      o.status       AS status,
      o.created_at   AS created_at,
      COALESCE(o.currency, 'INR') AS currency,
      vlines.vendor_total AS vendor_total,
      vlines.item_qty     AS item_qty,
      o.address_snapshot AS address_snapshot
    FROM orders o
    ${vlinesSql}
    ${whereSql}
    ORDER BY ${sortCol} ${dir}
    ${limitSql}
  `);

  const data = rows.map((r) => {
    let snap: any = r.address_snapshot;
    if (typeof snap === "string") {
      try {
        snap = JSON.parse(snap);
      } catch {
        snap = null;
      }
    }
    return {
      order_id: r.order_id,
      order_number: r.order_number,
      status: r.status,
      created_at: r.created_at ? new Date(r.created_at).toISOString() : null,
      currency: r.currency ?? "INR",
      vendor_total: Number(r.vendor_total ?? 0),
      item_qty: Number(r.item_qty ?? 0),
      address_snapshot: snap ?? null,
    };
  });

  return NextResponse.json({ data, count }, { headers: { "cache-control": "no-store" } });
}
