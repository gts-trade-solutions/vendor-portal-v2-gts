export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { getRouteVendor } from "@/lib/auth/getRouteVendor";
import { assertVendorWriter } from "@/lib/auth/assertVendorWriter";
import { prisma } from "@/lib/db/prisma";
import { mergeProducts, MergeError } from "@/lib/products/mergeProducts";
import { logActivity } from "@/lib/db/activityLog";

const json = (d: any, s = 200) =>
  NextResponse.json(d, { status: s, headers: { "cache-control": "no-store" } });

// GET — candidate merge pairs for the caller's vendor: a PUBLISHED product that
// has a HIDDEN, non-archived same-normalized-name counterpart (the legacy
// two-product split). Drives a future "merge" UI.
export async function GET() {
  const ctx = await getRouteVendor();
  if (!ctx) return json({ ok: false, error: "Unauthorized" }, 401);
  const norm = (c: string) => Prisma.raw(`LOWER(REGEXP_REPLACE(${c},'[^a-zA-Z0-9]+',''))`);
  const rows = await prisma.$queryRaw<any[]>(Prisma.sql`
    SELECT pub.id survivor_id, pub.name survivor_name, pub.price online_price, pub.vendor_price survivor_vendor_price,
           h.id duplicate_id, h.name duplicate_name, h.price duplicate_vendor_price,
           (SELECT COUNT(*) FROM inventory_units u WHERE u.product_id = h.id) duplicate_units
    FROM products pub
    JOIN products h
      ON h.is_published = 0 AND h.deleted_at IS NULL AND h.vendor_id = pub.vendor_id
     AND ${norm("h.name")} = ${norm("pub.name")}
    WHERE pub.is_published = 1 AND pub.deleted_at IS NULL AND pub.vendor_id = ${ctx.vendor.id}
    ORDER BY duplicate_units DESC`);
  const pairs = rows.map((r) => ({
    survivor_id: r.survivor_id,
    survivor_name: r.survivor_name,
    online_price: r.online_price != null ? Number(r.online_price) : null,
    survivor_vendor_price: r.survivor_vendor_price != null ? Number(r.survivor_vendor_price) : null,
    duplicate_id: r.duplicate_id,
    duplicate_name: r.duplicate_name,
    duplicate_vendor_price: r.duplicate_vendor_price != null ? Number(r.duplicate_vendor_price) : null,
    duplicate_units: Number(r.duplicate_units ?? 0),
  }));
  return json({ ok: true, pairs });
}

// POST — merge a duplicate (hidden) product into a survivor (published). Owner/
// manager only; both must belong to the caller's vendor. Atomic + reversible.
//   body: { survivor_id, duplicate_id }
export async function POST(req: NextRequest) {
  const gate = await assertVendorWriter();
  if (!gate.ok) return gate.response;

  let body: any;
  try {
    body = await req.json();
  } catch {
    return json({ ok: false, error: "Invalid JSON body" }, 400);
  }
  const survivorId = String(body?.survivor_id || "").trim();
  const duplicateId = String(body?.duplicate_id || "").trim();
  const vpRaw = body?.vendor_price;
  const vendorPrice =
    vpRaw === "" || vpRaw == null || !Number.isFinite(Number(vpRaw))
      ? undefined
      : Number(vpRaw);

  try {
    const result = await prisma.$transaction((tx) =>
      mergeProducts(tx, { survivorId, duplicateId, vendorId: gate.vendor.id, vendorPrice }),
    );
    await logActivity({
      vendorId: gate.vendor.id,
      actorUserId: gate.userId,
      action: "product.merge",
      entityType: "product",
      entityId: survivorId,
      summary: `Merged a duplicate into product (moved ${result.unitsMoved} units)`,
      meta: { survivor_id: survivorId, duplicate_id: duplicateId, units_moved: result.unitsMoved },
    });
    return json({ ok: true, ...result });
  } catch (e: any) {
    if (e instanceof MergeError) return json({ ok: false, error: e.message }, 400);
    console.error("vendor/products/merge error", e);
    return json({ ok: false, error: e?.message || "Merge failed" }, 500);
  }
}
