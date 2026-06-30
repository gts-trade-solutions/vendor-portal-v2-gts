export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { Prisma } from "@prisma/client";
import { assertVendorWriter } from "@/lib/auth/assertVendorWriter";
import { prisma } from "@/lib/db/prisma";
import { logActivity } from "@/lib/db/activityLog";

const json = (d: any, s = 200) =>
  NextResponse.json(d, { status: s, headers: { "cache-control": "no-store" } });

// Vendor-scoped batch creation of inventory_units. Replaces the browser
// `supabase.from("inventory_units").insert(rows)` + getNextSequenceStart reads
// in UnitUpsert.tsx.
//
// The endpoint OWNS the sequence: it derives the next numeric suffix server-side
// (scoped to this vendor+product+batchBaseCode), generates the rows, and inserts
// them atomically. This removes the race the client-side retry tried to paper
// over. Every row is stamped vendor_id = caller's vendor and the unit set is
// always under products.vendor_id = caller's vendor.
//
// Body:
//   { productId, batchBaseCode, count, manufactureDate, expiryDate, price }
// Returns { ok, created, start } where start is the first suffix used.

const MAX_BATCH_UNITS = 100;
const MAX_SUFFIX = 999;

function pad3(n: number) {
  return String(n).padStart(3, "0");
}

function parseSuffixNumber(unitCode: string) {
  const i = unitCode.lastIndexOf("-");
  if (i < 0) return null;
  const suffix = unitCode.slice(i + 1).trim();
  if (!/^\d+$/.test(suffix)) return null;
  const num = Number.parseInt(suffix, 10);
  return Number.isFinite(num) ? num : null;
}

async function getNextSequenceStart(vendorId: string, productId: string, base: string) {
  let maxFound = 0;
  const pageSize = 1000;
  let skip = 0;
  const HARD_CAP = 20000;

  while (skip < HARD_CAP) {
    const rows = await prisma.inventory_units.findMany({
      where: {
        vendor_id: vendorId,
        product_id: productId,
        unit_code: { startsWith: `${base}-` },
      },
      select: { unit_code: true },
      take: pageSize,
      skip,
    });
    for (const r of rows) {
      const n = parseSuffixNumber(r.unit_code);
      if (n != null && n > maxFound) maxFound = n;
    }
    if (rows.length < pageSize) break;
    skip += pageSize;
  }
  return maxFound + 1;
}

export async function POST(req: Request) {
  const gate = await assertVendorWriter();
  if (!gate.ok) return gate.response;
  const vendorId = gate.vendor.id;

  try {
    const body = await req.json();
    const productId = String(body?.productId || "");

    // ---- single-unit create with an explicit unit_code (legacy manual dialog) ----
    if (body?.mode === "single") {
      const unitCode = String(body?.unitCode || "").trim();
      if (!productId) return json({ ok: false, error: "MISSING_PRODUCT_ID" }, 400);
      if (!unitCode) return json({ ok: false, error: "MISSING_UNIT_CODE" }, 400);

      const product = await prisma.products.findFirst({
        where: { id: productId, vendor_id: vendorId },
        select: { id: true },
      });
      if (!product) return json({ ok: false, error: "PRODUCT_NOT_FOUND" }, 404);

      const mfg = body?.manufactureDate ? new Date(String(body.manufactureDate)) : null;
      const exp = body?.expiryDate ? new Date(String(body.expiryDate)) : null;
      const id = randomUUID();
      try {
        await prisma.inventory_units.create({
          data: {
            id,
            vendor_id: vendorId,
            product_id: productId,
            unit_code: unitCode,
            // schema requires non-null manufacture/expiry dates; fall back to today.
            manufacture_date: mfg ?? new Date(),
            expiry_date: exp ?? new Date(),
            price: new Prisma.Decimal(Number(body?.price ?? 0) || 0),
            status: "IN_STOCK",
          },
        });
      } catch (e: any) {
        if (e?.code === "P2002")
          return json({ ok: false, error: "Unit code already exists." }, 409);
        throw e;
      }
      await logActivity({
        vendorId,
        actorUserId: gate.userId,
        action: "unit.create",
        entityType: "product",
        entityId: productId,
        summary: "Created 1 inventory unit",
        meta: { count: 1, unit_code: unitCode },
      });
      return json({ ok: true, id });
    }

    const base = String(body?.batchBaseCode || "");
    const count = Math.min(MAX_BATCH_UNITS, Math.max(1, Math.floor(Number(body?.count || 1))));
    const manufactureDate = String(body?.manufactureDate || "");
    const expiryDate = String(body?.expiryDate || "");
    const price = Number(body?.price ?? 0);

    if (!productId) return json({ ok: false, error: "MISSING_PRODUCT_ID" }, 400);
    if (!base) return json({ ok: false, error: "MISSING_BASE_CODE" }, 400);
    if (!manufactureDate) return json({ ok: false, error: "MISSING_MFG_DATE" }, 400);
    if (!expiryDate) return json({ ok: false, error: "MISSING_EXP_DATE" }, 400);

    // Confirm the product belongs to the caller's vendor before inserting units.
    const product = await prisma.products.findFirst({
      where: { id: productId, vendor_id: vendorId },
      select: { id: true },
    });
    if (!product) return json({ ok: false, error: "PRODUCT_NOT_FOUND" }, 404);

    // Retry once on a unique-violation (concurrent batch on the same base code).
    for (let attempt = 1; attempt <= 2; attempt++) {
      const start = await getNextSequenceStart(vendorId, productId, base);
      if (start + count - 1 > MAX_SUFFIX) {
        return json(
          {
            ok: false,
            error: `Cannot create ${count} units. Sequence would exceed ${MAX_SUFFIX} (starting at ${start}).`,
          },
          400,
        );
      }

      const mfg = new Date(manufactureDate);
      const exp = new Date(expiryDate);
      const rows = Array.from({ length: count }).map((_, i) => ({
        id: randomUUID(),
        vendor_id: vendorId,
        product_id: productId,
        unit_code: `${base}-${pad3(start + i)}`,
        scan_code: base,
        manufacture_date: mfg,
        expiry_date: exp,
        price: new Prisma.Decimal(Number.isFinite(price) ? price : 0),
        status: "IN_STOCK",
      }));

      try {
        await prisma.inventory_units.createMany({ data: rows });
        await logActivity({
          vendorId,
          actorUserId: gate.userId,
          action: "unit.create",
          entityType: "product",
          entityId: productId,
          summary: `Created ${count} inventory unit${count === 1 ? "" : "s"}`,
          meta: { count, base, start },
        });
        return json({ ok: true, created: count, start });
      } catch (e: any) {
        // P2002 = unique constraint failed (unit_code). Retry once.
        if (attempt === 1 && e?.code === "P2002") continue;
        throw e;
      }
    }

    return json({ ok: false, error: "CREATE_FAILED" }, 500);
  } catch (e: any) {
    return json({ ok: false, error: e?.message || "CREATE_FAILED" }, 500);
  }
}
