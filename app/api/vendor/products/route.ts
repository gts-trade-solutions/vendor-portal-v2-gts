export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { getRouteVendor } from "@/lib/auth/getRouteVendor";
import { prisma } from "@/lib/db/prisma";
import { jsonSafe } from "@/lib/db/serialize";

const json = (d: any, s = 200) =>
  NextResponse.json(d, { status: s, headers: { "cache-control": "no-store" } });

// Vendor-scoped product reads. Replaces every browser
// `supabase.from("products").select(...)` in the vendor product/units/alerts
// pages. EVERY query below is constrained to ctx.vendor.id so a
// vendor can never read another vendor's products.
//
// Modes (query param ?mode=...):
//   - "single"      ?id=<productId>  -> one product (units page header / UnitUpsert)
//   - "alerts"                       -> id,name,sku for all vendor products (alerts page)
//   - default (list) -> paginated/filtered list w/ brand name + total count (products page)
export async function GET(req: Request) {
  const ctx = await getRouteVendor();
  if (!ctx) return json({ ok: false, error: "UNAUTHORIZED" }, 401);
  const vendorId = ctx.vendor.id;

  try {
    const url = new URL(req.url);
    const mode = url.searchParams.get("mode") || "list";

    // ---- single product (units page header + UnitUpsert dialog) ----
    if (mode === "single") {
      const id = url.searchParams.get("id") || "";
      if (!id) return json({ ok: false, error: "MISSING_ID" }, 400);
      const product = await prisma.products.findFirst({
        // scoped: only the caller's product
        where: { id, vendor_id: vendorId },
        select: {
          id: true,
          name: true,
          slug: true,
          vendor_id: true,
          product_code: true,
          brand_id: true,
          sale_price: true,
          // price + name + product_code + brand_id are what UnitUpsert needs;
          // include price too so the same row serves both callers.
          price: true,
        },
      });
      if (!product) return json({ ok: false, error: "NOT_FOUND" }, 404);
      return json({ ok: true, data: jsonSafe(product) });
    }

    // ---- edit mode: full product row + its images (ProductEditor load) ----
    // Mirrors the old `supabase.from("products").select("*").eq(id).eq(vendor_id)`
    // + `product_images` read. Vendor-scoped so a vendor can only load their own.
    if (mode === "edit") {
      const id = url.searchParams.get("id") || "";
      if (!id) return json({ ok: false, error: "MISSING_ID" }, 400);
      const product = await prisma.products.findFirst({
        where: { id, vendor_id: vendorId },
      });
      if (!product) return json({ ok: false, error: "NOT_FOUND" }, 404);
      const images = await prisma.product_images.findMany({
        where: { product_id: id },
        select: { id: true, storage_path: true, alt: true, sort_order: true },
        orderBy: { sort_order: "asc" },
      });
      return json({ ok: true, data: jsonSafe(product), images: jsonSafe(images) });
    }

    // ---- sku-check: which of the given SKUs already exist (bulk auto-SKU dedupe) ----
    // sku is globally unique, so this is a global existence check (matches the
    // original supabase `.in("sku", genSkus)` query). Returns only the SKU strings.
    if (mode === "sku-check") {
      const skusCsv = url.searchParams.get("skus") || "";
      const skus = skusCsv ? skusCsv.split(",").map((s) => s.trim()).filter(Boolean) : [];
      if (!skus.length) return json({ ok: true, data: [] });
      const rows = await prisma.products.findMany({
        where: { sku: { in: skus } },
        select: { sku: true },
      });
      return json({ ok: true, data: jsonSafe(rows) });
    }

    // ---- alerts page: all vendor products (id,name,sku) ----
    if (mode === "alerts") {
      const data = await prisma.products.findMany({
        where: { vendor_id: vendorId, deleted_at: null },
        select: { id: true, name: true, sku: true },
        take: 5000,
      });
      return json({ ok: true, data: jsonSafe(data) });
    }

    // ---- export: every vendor product with exportable fields (CSV/XLSX export) ----
    // Vendor-scoped. Returns a flat, human-readable row per product (brand/category
    // resolved to their names) so the products page can write an XLSX directly.
    if (mode === "export") {
      const rows = await prisma.products.findMany({
        where: { vendor_id: vendorId, deleted_at: null },
        select: {
          name: true,
          slug: true,
          sku: true,
          hsn: true,
          price: true,
          purchase_price: true,
          compare_at_price: true,
          sale_price: true,
          currency: true,
          short_description: true,
          is_published: true,
          brands: { select: { name: true } },
          categories: { select: { name: true } },
          _count: { select: { inventory_units: true } },
        },
        orderBy: { name: "asc" },
        take: 10000,
      });

      const data = rows.map((r) => ({
        name: r.name ?? "",
        slug: r.slug ?? "",
        sku: r.sku ?? "",
        hsn: r.hsn ?? "",
        brand: r.brands?.name ?? "",
        category: r.categories?.name ?? "",
        price: r.price ?? null,
        purchase_price: r.purchase_price ?? null,
        compare_at_price: r.compare_at_price ?? null,
        sale_price: r.sale_price ?? null,
        currency: r.currency ?? "INR",
        short_description: r.short_description ?? "",
        is_published: !!r.is_published,
        unit_count: r._count?.inventory_units ?? 0,
      }));

      return json({ ok: true, count: data.length, data: jsonSafe(data) });
    }

    // ---- default: paginated/filtered list for the products page ----
    const search = (url.searchParams.get("search") || "").trim();
    const brandId = url.searchParams.get("brandId") || "ALL";
    const published = url.searchParams.get("published") || "ALL"; // ALL | PUBLISHED | HIDDEN
    const sort = url.searchParams.get("sort") || "UPDATED_DESC"; // UPDATED_DESC | NAME_ASC
    const page = Math.max(1, Number(url.searchParams.get("page") || "1"));
    const pageSize = Math.min(200, Math.max(1, Number(url.searchParams.get("pageSize") || "20")));
    // optional product-id list from a units (barcode/unit_code) search, CSV.
    const idsCsv = url.searchParams.get("ids") || "";
    const unitProductIds = idsCsv ? idsCsv.split(",").map((s) => s.trim()).filter(Boolean) : [];

    // Hide soft-archived rows (e.g. duplicates removed by a product merge) so
    // the list reflects the unified single-product model.
    const where: any = { vendor_id: vendorId, deleted_at: null };

    if (search) {
      // name ILIKE OR slug ILIKE OR id IN (unit-search matches)
      const or: any[] = [
        { name: { contains: search } },
        { slug: { contains: search } },
      ];
      if (unitProductIds.length > 0) or.push({ id: { in: unitProductIds } });
      where.OR = or;
    }
    if (brandId !== "ALL") where.brand_id = brandId;
    if (published !== "ALL") where.is_published = published === "PUBLISHED";

    const orderBy =
      sort === "NAME_ASC" ? { name: "asc" as const } : { updated_at: "desc" as const };

    const [count, rows] = await Promise.all([
      prisma.products.count({ where }),
      prisma.products.findMany({
        where,
        select: {
          id: true,
          slug: true,
          name: true,
          price: true,
          vendor_price: true,
          sale_price: true,
          currency: true,
          is_published: true,
          updated_at: true,
          vendor_id: true,
          brand_id: true,
          brands: { select: { name: true } },
        },
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
