export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { assertVendorWriter } from "@/lib/auth/assertVendorWriter";
import { prisma } from "@/lib/db/prisma";
import { buildProductData } from "../_payload";
import { logActivity } from "@/lib/db/activityLog";

const json = (d: any, s = 200) =>
  NextResponse.json(d, { status: s, headers: { "cache-control": "no-store" } });

// Vendor-scoped product update (header fields only). Mirrors the update branch of
// ProductEditor.save(): update the product payload WHERE id = :id AND
// vendor_id = caller's vendor (updateMany scoped) so a vendor can never touch
// another vendor's product. Returns { ok, id }.
export async function POST(req: Request) {
  const gate = await assertVendorWriter();
  if (!gate.ok) return gate.response;
  const vendorId = gate.vendor.id;

  try {
    const body = await req.json().catch(() => ({} as any));
    const id = String(body?.id || "");
    if (!id) return json({ ok: false, error: "MISSING_ID" }, 400);

    // Lightweight publish toggle (products list page) — partial update of just
    // is_published when no full payload is supplied. Still vendor-scoped.
    if (body?.payload == null && typeof body?.is_published === "boolean") {
      const res = await prisma.products.updateMany({
        where: { id, vendor_id: vendorId },
        data: { is_published: body.is_published },
      });
      if (res.count === 0) return json({ ok: false, error: "NOT_FOUND" }, 404);
      await logActivity({
        vendorId,
        actorUserId: gate.userId,
        action: "product.update",
        entityType: "product",
        entityId: id,
        summary: body.is_published ? "Published product" : "Unpublished product",
        meta: { publish_toggle: true, is_published: body.is_published },
      });
      return json({ ok: true, id });
    }

    const payload = body?.payload ?? {};
    const data = buildProductData(payload);
    if (!data.category_id) return json({ ok: false, error: "CATEGORY_REQUIRED" }, 400);

    try {
      const res = await prisma.products.updateMany({
        where: { id, vendor_id: vendorId },
        data: { ...data, category_id: data.category_id },
      });
      if (res.count === 0) return json({ ok: false, error: "NOT_FOUND" }, 404);
      await logActivity({
        vendorId,
        actorUserId: gate.userId,
        action: "product.update",
        entityType: "product",
        entityId: id,
        summary: `Updated product ${(payload as any)?.name || ""}`.trim(),
      });
      return json({ ok: true, id });
    } catch (e: any) {
      if (e?.code === "P2002") {
        const target = Array.isArray(e?.meta?.target) ? e.meta.target.join(", ") : e?.meta?.target;
        return json({ ok: false, error: `Duplicate value for ${target || "a unique field"}.` }, 409);
      }
      throw e;
    }
  } catch (e: any) {
    return json({ ok: false, error: e?.message || "UPDATE_FAILED" }, 500);
  }
}
