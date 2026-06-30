export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { getRouteVendor } from "@/lib/auth/getRouteVendor";
import { prisma } from "@/lib/db/prisma";
import { jsonSafe } from "@/lib/db/serialize";

const json = (d: any, s = 200) =>
  NextResponse.json(d, { status: s, headers: { "cache-control": "no-store" } });

// Vendor-scoped inventory_units reads. Replaces every browser
// `supabase.from("inventory_units").select(...)` in the vendor products / units
// detail / alerts pages. EVERY query is constrained to ctx.vendor.id (and, where
// the page scoped it, product_id) so a vendor can never read another vendor's
// units.
//
// Modes (?mode=...):
//   - "product-id-search" ?term=    -> distinct product_ids whose unit_code/scan_code match (products page search)
//   - "summary"           ?productIds=csv -> {product_id,status,expiry_date} rows (products page per-product unit summary)
//   - "alerts"                      -> {id,product_id,unit_code,status,expiry_date} for all vendor units (alerts page)
//   - "list"   ?productId=&filters&sort&page&pageSize -> paginated filtered units + count (units page table)
//   - "counts" ?productId=&filters  -> per-status counts ignoring statusFilter (units page header counts)
//   - "verified-count" ?productId=&(ids=csv | filters) -> count of is_verified units in target set (bulk-delete meta)
//   - "shared-remaining" ?productId= -> {unit_code,scan_code,status} for all units of product (shared-code remaining)
//   - "by-ids" ?productId=&ids=csv  -> full unit rows for selected ids (invoice from selection)
//   - "scan"   ?productId=&code=    -> single unit matching unit_code OR scan_code (scan lookup)

// Build the Prisma `where` for the units-page filters, mirroring applyUnitFilters.
function buildFilterWhere(
  url: URL,
  vendorId: string,
  productId: string,
  opts: { includeStatus?: boolean } = { includeStatus: true },
) {
  const where: any = { vendor_id: vendorId, product_id: productId };
  const and: any[] = [];

  const statusFilter = url.searchParams.get("statusFilter") || "ALL";
  if (opts.includeStatus !== false && statusFilter !== "ALL") {
    where.status = statusFilter;
  }

  const search = (url.searchParams.get("search") || "").trim();
  if (search) {
    and.push({
      OR: [
        { unit_code: { contains: search } },
        { scan_code: { contains: search } },
      ],
    });
  }

  const todayYmd = url.searchParams.get("today") || new Date().toISOString().slice(0, 10);
  const today = new Date(todayYmd);
  const expiredFilter = url.searchParams.get("expiredFilter") || "ALL";
  const includeNoExpiry = url.searchParams.get("includeNoExpiry") !== "false";

  if (expiredFilter === "EXPIRED") {
    and.push({ expiry_date: { not: null } });
    and.push({ expiry_date: { lt: today } });
  } else if (expiredFilter === "NOT_EXPIRED") {
    if (includeNoExpiry) {
      and.push({ OR: [{ expiry_date: null }, { expiry_date: { gte: today } }] });
    } else {
      and.push({ expiry_date: { gte: today } });
    }
  }

  const mfgFrom = url.searchParams.get("mfgFrom");
  const mfgTo = url.searchParams.get("mfgTo");
  if (mfgFrom) and.push({ manufacture_date: { gte: new Date(mfgFrom) } });
  if (mfgTo) and.push({ manufacture_date: { lte: new Date(mfgTo) } });

  const expFrom = url.searchParams.get("expFrom");
  const expTo = url.searchParams.get("expTo");
  if (expFrom || expTo) {
    if (!includeNoExpiry) {
      if (expFrom) and.push({ expiry_date: { gte: new Date(expFrom) } });
      if (expTo) and.push({ expiry_date: { lte: new Date(expTo) } });
    } else {
      const range: any = {};
      if (expFrom) range.gte = new Date(expFrom);
      if (expTo) range.lte = new Date(expTo);
      and.push({ OR: [{ expiry_date: null }, { expiry_date: range }] });
    }
  }

  if (and.length) where.AND = and;
  return where;
}

const LIST_SELECT = {
  id: true,
  unit_code: true,
  scan_code: true,
  manufacture_date: true,
  expiry_date: true,
  status: true,
  created_at: true,
  price: true,
  sold_customer_id: true,
  sold_customer_name: true,
  sold_customer_phone: true,
  demo_customer_id: true,
  demo_customer_name: true,
  demo_customer_phone: true,
  demo_at: true,
  is_verified: true,
  verified_at: true,
} as const;

export async function GET(req: Request) {
  const ctx = await getRouteVendor();
  if (!ctx) return json({ ok: false, error: "UNAUTHORIZED" }, 401);
  const vendorId = ctx.vendor.id;

  try {
    const url = new URL(req.url);
    const mode = url.searchParams.get("mode") || "list";
    const productId = url.searchParams.get("productId") || "";

    // ---- products page: product_ids whose units match a search term ----
    if (mode === "product-id-search") {
      const term = (url.searchParams.get("term") || "").trim();
      if (!term) return json({ ok: true, data: [] });
      const rows = await prisma.inventory_units.findMany({
        where: {
          vendor_id: vendorId,
          OR: [{ unit_code: { contains: term } }, { scan_code: { contains: term } }],
        },
        select: { product_id: true },
        take: 1000,
      });
      const ids = Array.from(new Set(rows.map((r) => r.product_id).filter(Boolean)));
      return json({ ok: true, data: ids });
    }

    // ---- next sequence start for a batch base code (create dialog preview) ----
    // Vendor+product scoped; returns the next numeric suffix after the max
    // existing `${base}-NNN`. Authoritative sequencing happens in the create
    // endpoint; this is just for the live preview.
    if (mode === "next-seq") {
      const base = (url.searchParams.get("base") || "").trim();
      if (!productId) return json({ ok: false, error: "MISSING_PRODUCT_ID" }, 400);
      if (!base) return json({ ok: true, next: 1 });
      let maxFound = 0;
      const pageSize = 1000;
      let skip = 0;
      const HARD_CAP = 20000;
      while (skip < HARD_CAP) {
        const rows = await prisma.inventory_units.findMany({
          where: { vendor_id: vendorId, product_id: productId, unit_code: { startsWith: `${base}-` } },
          select: { unit_code: true },
          take: pageSize,
          skip,
        });
        for (const r of rows) {
          const i = r.unit_code.lastIndexOf("-");
          const suffix = i >= 0 ? r.unit_code.slice(i + 1).trim() : "";
          if (/^\d+$/.test(suffix)) {
            const n = Number.parseInt(suffix, 10);
            if (Number.isFinite(n) && n > maxFound) maxFound = n;
          }
        }
        if (rows.length < pageSize) break;
        skip += pageSize;
      }
      return json({ ok: true, next: maxFound + 1 });
    }

    // ---- duplicate unit_code check (unit edit dialog) ----
    // Returns { exists, sameId } for a candidate unit_code within this vendor.
    if (mode === "dup-check") {
      const code = (url.searchParams.get("code") || "").trim();
      const exceptId = url.searchParams.get("exceptId") || "";
      if (!code) return json({ ok: true, exists: false });
      const found = await prisma.inventory_units.findFirst({
        where: { vendor_id: vendorId, unit_code: code },
        select: { id: true },
      });
      return json({
        ok: true,
        exists: !!found && found.id !== exceptId,
      });
    }

    // ---- products page: per-product unit summary rows ----
    if (mode === "summary") {
      const idsCsv = url.searchParams.get("productIds") || "";
      const productIds = idsCsv.split(",").map((s) => s.trim()).filter(Boolean);
      if (productIds.length === 0) return json({ ok: true, data: [] });
      const rows = await prisma.inventory_units.findMany({
        where: { vendor_id: vendorId, product_id: { in: productIds } },
        select: { product_id: true, status: true, expiry_date: true },
      });
      return json({ ok: true, data: jsonSafe(rows) });
    }

    // ---- alerts page: all vendor units ----
    if (mode === "alerts") {
      const rows = await prisma.inventory_units.findMany({
        where: { vendor_id: vendorId },
        select: { id: true, product_id: true, unit_code: true, status: true, expiry_date: true },
        take: 20000,
      });
      return json({ ok: true, data: jsonSafe(rows) });
    }

    // Everything below is product-scoped (units detail page).
    if (!productId) return json({ ok: false, error: "MISSING_PRODUCT_ID" }, 400);

    // ---- units page header counts (per status, ignoring statusFilter) ----
    if (mode === "counts") {
      const statuses = ["IN_STOCK", "INVOICED", "DEMO", "SOLD", "RETURNED", "OUT_OF_STOCK"] as const;
      const out: Record<string, number> = {
        IN_STOCK: 0, INVOICED: 0, DEMO: 0, SOLD: 0, RETURNED: 0, OUT_OF_STOCK: 0,
      };
      await Promise.all(
        statuses.map(async (s) => {
          const where = buildFilterWhere(url, vendorId, productId, { includeStatus: false });
          where.status = s;
          out[s] = await prisma.inventory_units.count({ where });
        }),
      );
      return json({ ok: true, data: out });
    }

    // ---- bulk-delete verified count (selected ids OR filtered set) ----
    if (mode === "verified-count") {
      const idsCsv = url.searchParams.get("ids");
      if (idsCsv != null) {
        const ids = idsCsv.split(",").map((s) => s.trim()).filter(Boolean);
        if (ids.length === 0) return json({ ok: true, data: 0 });
        const count = await prisma.inventory_units.count({
          where: { vendor_id: vendorId, product_id: productId, id: { in: ids }, is_verified: true },
        });
        return json({ ok: true, data: count });
      }
      const where = buildFilterWhere(url, vendorId, productId);
      where.is_verified = true;
      const count = await prisma.inventory_units.count({ where });
      return json({ ok: true, data: count });
    }

    // ---- shared-code remaining ----
    if (mode === "shared-remaining") {
      const rows = await prisma.inventory_units.findMany({
        where: { vendor_id: vendorId, product_id: productId },
        select: { unit_code: true, scan_code: true, status: true },
      });
      return json({ ok: true, data: jsonSafe(rows) });
    }

    // ---- full unit rows for a set of selected ids ----
    if (mode === "by-ids") {
      const idsCsv = url.searchParams.get("ids") || "";
      const ids = idsCsv.split(",").map((s) => s.trim()).filter(Boolean);
      if (ids.length === 0) return json({ ok: true, data: [] });
      const rows = await prisma.inventory_units.findMany({
        where: { vendor_id: vendorId, product_id: productId, id: { in: ids } },
        select: LIST_SELECT,
        orderBy: { created_at: "desc" },
      });
      return json({ ok: true, data: jsonSafe(rows) });
    }

    // ---- export: all filtered rows (no pagination) for CSV export ----
    if (mode === "export") {
      const where = buildFilterWhere(url, vendorId, productId);
      const rows = await prisma.inventory_units.findMany({
        where,
        select: LIST_SELECT,
        orderBy: { created_at: "desc" },
        take: 50000,
      });
      return json({ ok: true, data: jsonSafe(rows) });
    }

    // ---- scan lookup: single unit by unit_code OR scan_code ----
    if (mode === "scan") {
      const code = (url.searchParams.get("code") || "").trim();
      if (!code) return json({ ok: true, data: null });
      const row = await prisma.inventory_units.findFirst({
        where: {
          vendor_id: vendorId,
          product_id: productId,
          OR: [{ unit_code: code }, { scan_code: code }],
        },
        select: LIST_SELECT,
        orderBy: { created_at: "asc" },
      });
      return json({ ok: true, data: jsonSafe(row) });
    }

    // ---- default: paginated/filtered units list + total count ----
    const sortBy = url.searchParams.get("sortBy") || "created_desc";
    const page = Math.max(1, Number(url.searchParams.get("page") || "1"));
    const pageSize = Math.min(500, Math.max(1, Number(url.searchParams.get("pageSize") || "20")));

    const orderBy = (() => {
      switch (sortBy) {
        case "created_asc": return { created_at: "asc" as const };
        case "exp_asc": return { expiry_date: "asc" as const };
        case "exp_desc": return { expiry_date: "desc" as const };
        case "mfg_desc": return { manufacture_date: "desc" as const };
        case "mfg_asc": return { manufacture_date: "asc" as const };
        case "code_asc": return { unit_code: "asc" as const };
        case "code_desc": return { unit_code: "desc" as const };
        default: return { created_at: "desc" as const };
      }
    })();

    const where = buildFilterWhere(url, vendorId, productId);
    const [count, rows] = await Promise.all([
      prisma.inventory_units.count({ where }),
      prisma.inventory_units.findMany({
        where,
        select: LIST_SELECT,
        orderBy,
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ]);
    return json({ ok: true, count, data: jsonSafe(rows) });
  } catch (e: any) {
    return json({ ok: false, error: e?.message || "READ_FAILED" }, 500);
  }
}
