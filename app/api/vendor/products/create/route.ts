export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { assertVendorWriter } from "@/lib/auth/assertVendorWriter";
import { prisma } from "@/lib/db/prisma";
import { buildProductData } from "../_payload";
import { logActivity } from "@/lib/db/activityLog";

const json = (d: any, s = 200) =>
  NextResponse.json(d, { status: s, headers: { "cache-control": "no-store" } });

// Vendor-scoped product create (header fields only — media is handled by
// /api/vendor/products/media after the client uploads the files). Mirrors the
// create branch of ProductEditor.save(): insert the product payload stamped with
// vendor_id = caller's vendor, return { ok, id }.
export async function POST(req: Request) {
  const gate = await assertVendorWriter();
  if (!gate.ok) return gate.response;
  const vendorId = gate.vendor.id;

  try {
    const body = await req.json().catch(() => ({} as any));
    const payload = body?.payload ?? {};

    const data = buildProductData(payload);
    if (!data.category_id) return json({ ok: false, error: "CATEGORY_REQUIRED" }, 400);

    const id = randomUUID();
    try {
      const created = await prisma.products.create({
        data: {
          id,
          vendor_id: vendorId,
          ...data,
          category_id: data.category_id, // non-null
        },
        select: { id: true },
      });
      await logActivity({
        vendorId,
        actorUserId: gate.userId,
        action: "product.create",
        entityType: "product",
        entityId: created.id,
        summary: `Created product ${(payload as any)?.name || ""}`.trim(),
      });
      return json({ ok: true, id: created.id });
    } catch (e: any) {
      // P2002 = unique constraint (sku / slug / product_code).
      if (e?.code === "P2002") {
        const target = Array.isArray(e?.meta?.target) ? e.meta.target.join(", ") : e?.meta?.target;
        return json({ ok: false, error: `Duplicate value for ${target || "a unique field"}.` }, 409);
      }
      throw e;
    }
  } catch (e: any) {
    return json({ ok: false, error: e?.message || "CREATE_FAILED" }, 500);
  }
}
