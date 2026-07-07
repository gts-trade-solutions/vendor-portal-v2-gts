export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { assertVendorWriter } from "@/lib/auth/assertVendorWriter";
import { prisma } from "@/lib/db/prisma";
import { logActivity } from "@/lib/db/activityLog";

const json = (d: any, s = 200) =>
  NextResponse.json(d, { status: s, headers: { "cache-control": "no-store" } });

// Vendor-scoped STOCK TRANSFER: move inventory units from their current product
// to another product owned by the SAME vendor. Owner/manager only (write gate).
//
// Body: { unit_ids: string[], target_product_id: string }
//
// Rules:
//   - target product must belong to the caller's vendor (else 404)
//   - every selected unit must belong to the caller's vendor (cross-vendor /
//     unknown ids are silently ignored — only the scoped set is touched)
//   - only units with status IN_STOCK / DEMO / RETURNED may move. If ANY selected
//     (and vendor-owned) unit is SOLD or INVOICED, the whole transfer is rejected
//     (400) and nothing moves.
//   - on transfer we also set brand_id to the target product's brand_id so the
//     unit stays consistent with its new product.

const TRANSFERABLE = new Set(["IN_STOCK", "DEMO", "RETURNED"]);

export async function POST(req: Request) {
  const gate = await assertVendorWriter();
  if (!gate.ok) return gate.response;
  const ctx = { vendor: gate.vendor, userId: gate.userId };

  try {
    const body = await req.json();

    const unit_ids: string[] = Array.isArray(body?.unit_ids)
      ? body.unit_ids.map((x: any) => String(x)).filter(Boolean)
      : [];
    const target_product_id: string = body?.target_product_id
      ? String(body.target_product_id)
      : "";

    if (unit_ids.length === 0)
      return json({ ok: false, error: "No units selected" }, 400);
    if (!target_product_id)
      return json({ ok: false, error: "Target product is required" }, 400);

    const result = await prisma.$transaction(async (tx) => {
      // 1) target product must belong to the caller's vendor
      const target = await tx.products.findFirst({
        where: { id: target_product_id, vendor_id: ctx.vendor.id },
        select: { id: true, name: true, brand_id: true },
      });
      if (!target) {
        return { error: "Target product not found", status: 404 as const };
      }

      // 2) load the caller's own units from the requested set. Unknown /
      //    cross-vendor ids simply won't appear here, so they're ignored.
      const owned = await tx.inventory_units.findMany({
        where: {
          id: { in: unit_ids },
          products: { vendor_id: ctx.vendor.id },
        },
        select: { id: true, status: true },
      });

      if (owned.length === 0) {
        return { error: "No transferable units found", status: 400 as const };
      }

      // 3) block if any owned unit is sold/invoiced (don't transfer any)
      const blocked = owned.filter((u) => !TRANSFERABLE.has(u.status));
      if (blocked.length > 0) {
        return {
          error: `${blocked.length} unit(s) are sold/invoiced and cannot be transferred`,
          status: 400 as const,
        };
      }

      const validIds = owned.map((u) => u.id);

      // 4) move them onto the target product (+ keep brand_id consistent)
      const upd = await tx.inventory_units.updateMany({
        where: {
          id: { in: validIds },
          // Scope by the unit's own vendor_id (validIds already ownership-checked above).
          // Not the products relation — moving units fires the stock_qty trigger which
          // updates `products`; referencing it in this statement would trip 1442.
          vendor_id: ctx.vendor.id,
        },
        data: {
          product_id: target_product_id,
          brand_id: target.brand_id,
          updated_at: new Date(),
        },
      });

      return {
        ok: true as const,
        count: upd.count,
        validIds,
        targetName: target.name,
      };
    },
    // Moving units changes their product_id, firing the stock_qty triggers per
    // row; a large transfer can exceed Prisma's default 5s timeout. Give headroom.
    { timeout: 60_000, maxWait: 10_000 });

    if ("error" in result) {
      return json({ ok: false, error: result.error }, result.status);
    }

    await logActivity({
      vendorId: ctx.vendor.id,
      actorUserId: ctx.userId,
      action: "unit.transfer",
      entityType: "product",
      entityId: target_product_id,
      summary: `Transferred ${result.count} units to ${result.targetName ?? "product"}`,
      meta: {
        count: result.count,
        target_product_id,
        from_unit_ids: result.validIds,
      },
    });

    return json({ ok: true, transferred: result.count });
  } catch (e: any) {
    return json({ ok: false, error: e?.message || "TRANSFER_FAILED" }, 500);
  }
}
